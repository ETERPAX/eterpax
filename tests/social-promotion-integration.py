"""Disposable local PostgreSQL. Synthetic hashes only; no Supabase/provider calls."""
import concurrent.futures
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
BIN = pathlib.Path(os.environ.get('PG_BIN', '/usr/local/opt/postgresql@17/bin'))

def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'

def digest(n):
    return hashlib.sha256(f'LOCAL-TEST-ONLY-{n}'.encode()).hexdigest()

inventory = [dict(platform=p, slot=i, digest=digest(j * 10 + i))
             for j, p in enumerate(('instagram', 'facebook')) for i in range(1, 11)]
with tempfile.TemporaryDirectory(prefix='epx-promo-') as temp:
    base = pathlib.Path(temp)
    def run(name, *args, sql=None):
        result = subprocess.run([str(BIN/name), *map(str, args)], input=sql, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()
    run('initdb', '-D', base/'data', '-U', 'postgres', '-A', 'trust', '--no-locale')
    started = False
    try:
        run('pg_ctl', '-D', base/'data', '-l', base/'log', '-o', f"-k {base} -p 55459 -c listen_addresses=''", '-w', 'start')
        started = True
        def sql(query):
            return run('psql', '-X', '-qAt', '-h', base, '-p', '55459', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', sql="SET timezone='UTC';\n" + query)
        def redeem(user, code):
            return json.loads(sql(f"SET ROLE service_role; SELECT public.redeem_social_promotion('{uid(user)}','{digest(code)}');"))['status']
        sql('''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now(),email_confirmed_at timestamptz);
CREATE TABLE public.subscriptions(user_id uuid,status text,stripe_subscription_id text UNIQUE,stripe_customer_id text,stripe_price_id text,current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean,canceled_at timestamptz,updated_at timestamptz);
CREATE TABLE public.guardians(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,name text,email text,relationship text);
CREATE TABLE public.check_ins(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid UNIQUE,frequency_days integer DEFAULT 30,enabled boolean DEFAULT false,status text DEFAULT 'scheduled',missed_count integer DEFAULT 0,last_check_in_at timestamptz,next_check_in_at timestamptz DEFAULT now()+interval '30 days',response_deadline_at timestamptz);
''')
        for migration in ('202610060002_guardian_confirmation_model.sql', '202610060003_guardian_notification_selection.sql', '202610210002_account_activation_policy.sql', '202610210004_three_plans.sql', '202611010001_social_annual_promotion.sql'):
            sql((ROOT/'supabase/migrations'/migration).read_text())
        for i in range(1, 40):
            sql(f"INSERT INTO auth.users(id,email_confirmed_at) VALUES('{uid(i)}',now());")
        install = "SELECT public.install_social_promotion('" + json.dumps(inventory) + "');"
        assert sql(install) == 'installed'
        assert sql(install) == 'already_installed'
        assert sql('SELECT count(*) FROM promotion_codes') == '20'
        altered = [dict(row) for row in inventory]
        altered[0]['digest'] = digest(999)
        try:
            sql("SELECT install_social_promotion('" + json.dumps(altered) + "');")
            raise AssertionError('Inventory replacement permitted')
        except RuntimeError:
            pass
        assert redeem(1, 1) == 'unavailable'
        try:
            sql('UPDATE promotion_campaign SET enabled=true;')
            raise AssertionError('Unreviewed expiry policy enabled')
        except RuntimeError:
            pass
        # TEST ONLY: production deployment remains disabled, no policy selected.
        sql("UPDATE promotion_campaign SET expiry_policy='retain_data_and_continuity',enabled=true;")
        sql(f"INSERT INTO check_ins(user_id) VALUES('{uid(1)}');")
        assert redeem(1, 1) == 'success'
        sql(f"""DO $$ BEGIN
IF NOT EXISTS(SELECT 1 FROM promotional_access WHERE user_id='{uid(1)}' AND starts_at=redeemed_at AND expires_at=starts_at+interval '12 months') THEN RAISE EXCEPTION 'term'; END IF;
IF NOT public.has_plan_access('{uid(1)}') OR public.has_paid_plan('{uid(1)}') THEN RAISE EXCEPTION 'access kind'; END IF;
IF NOT EXISTS(SELECT 1 FROM check_ins c JOIN promotional_access p USING(user_id) WHERE c.user_id='{uid(1)}' AND c.enabled AND NOT c.awaiting_plan_activation AND c.next_check_in_at=p.starts_at+interval '30 days' AND c.missed_count=0 AND c.last_check_in_at IS NULL) THEN RAISE EXCEPTION 'initial activation'; END IF;
IF EXISTS(SELECT 1 FROM subscriptions) OR EXISTS(SELECT 1 FROM lifetime_access) OR EXISTS(SELECT 1 FROM guardian_notifications) THEN RAISE EXCEPTION 'unexpected side effect'; END IF;
END $$;""")
        assert redeem(2, 1) == 'used'
        assert redeem(1, 11) == 'ineligible'  # second platform, same owner
        assert redeem(3, 999) == 'invalid'
        for _ in range(4):
            assert redeem(3, 999) == 'invalid'
        assert redeem(3, 2) == 'rate_limited'
        sql(f"UPDATE promotion_attempts SET window_started_at=now()-interval '16 minutes' WHERE user_id='{uid(3)}';")
        assert redeem(3, 2) == 'success'
        sql(f"UPDATE auth.users SET email_confirmed_at=NULL WHERE id='{uid(4)}';")
        assert redeem(4, 3) == 'ineligible'
        # Paid records, billing fields and Check-in survive byte-for-byte.
        sql(f"INSERT INTO subscriptions(user_id,status,stripe_subscription_id,cancel_at_period_end) VALUES('{uid(5)}','active','sub_LOCAL_ONLY',false);")
        before = sql('SELECT jsonb_agg(to_jsonb(s)) FROM subscriptions s')
        assert redeem(5, 3) == 'ineligible'
        assert sql('SELECT jsonb_agg(to_jsonb(s)) FROM subscriptions s') == before
        # Existing cycle and history must not change on redemption or expiry.
        sql(f"INSERT INTO check_ins(user_id,status,missed_count,last_check_in_at,response_deadline_at) VALUES('{uid(6)}','awaiting_response',1,now()-interval '31 days',now()+interval '1 day');")
        existing = sql(f"SELECT to_jsonb(c) FROM check_ins c WHERE user_id='{uid(6)}'")
        assert redeem(6, 3) == 'success'
        assert sql(f"SELECT to_jsonb(c) FROM check_ins c WHERE user_id='{uid(6)}'") == existing
        # Both requests start together, and the first keeps its transaction open
        # so the other must wait for the real PostgreSQL locks, not a mock.
        def concurrent_call(user, code):
            return sql(f"BEGIN; SET ROLE service_role; SELECT redeem_social_promotion('{uid(user)}','{digest(code)}')->>'status'; SELECT pg_sleep(0.3); COMMIT;").strip()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda u: concurrent_call(u, 4), (7, 8)))
        assert sorted(results) == ['success', 'used'], results
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda c: concurrent_call(9, c), (5, 15)))
        assert sorted(results) == ['ineligible', 'success'], results
        # Configuration saved after redemption starts in the future, not at an
        # old redemption date; expired promotional history cannot start it.
        assert redeem(10, 6) == 'success'
        sql(f"INSERT INTO check_ins(user_id) VALUES('{uid(10)}');")
        assert sql(f"SELECT enabled AND NOT awaiting_plan_activation AND next_check_in_at>now()+interval '29 days' FROM check_ins WHERE user_id='{uid(10)}'") == 't'
        assert redeem(11, 7) == 'success'
        sql(f"UPDATE promotional_access SET redeemed_at=now()-interval '13 months',starts_at=now()-interval '13 months',expires_at=(now()-interval '13 months')+interval '12 months' WHERE user_id='{uid(11)}'; INSERT INTO check_ins(user_id) VALUES('{uid(11)}');")
        assert sql(f"SELECT NOT enabled AND awaiting_plan_activation FROM check_ins WHERE user_id='{uid(11)}'") == 't'
        # Calendar-year semantics including leap day; never a fixed 365-day term.
        assert sql("SET timezone='UTC'; SELECT ('2028-02-29 12:34:56+00'::timestamptz+interval '12 months')='2029-02-28 12:34:56+00'::timestamptz;") == 't'
        sql(f"""BEGIN;
SET timezone='UTC';
UPDATE promotional_access SET redeemed_at=now()-interval '12 months',starts_at=now()-interval '12 months',expires_at=now() WHERE user_id='{uid(6)}';
SET request.jwt.claim.sub='{uid(6)}';
DO $$ BEGIN
IF public.has_plan_access(auth.uid()) THEN RAISE EXCEPTION 'expiry boundary'; END IF;
IF public.get_account_activation_eligibility()->>'status'<>'promotion_expired' THEN RAISE EXCEPTION 'expired paid misclassification'; END IF;
END $$;
COMMIT;""")
        assert sql(f"SELECT to_jsonb(c) FROM check_ins c WHERE user_id='{uid(6)}'") == existing
        assert redeem(6, 16) == 'ineligible'  # lifetime benefit limit even after expiry
        # Server-only hashes/mutations and auth.uid-bound account reads.
        sql(f"""SET ROLE authenticated; SET request.jwt.claim.sub='{uid(1)}';
DO $$ BEGIN
IF public.get_promotional_access()->>'platform'<>'instagram' THEN RAISE EXCEPTION 'own read'; END IF;
IF public.get_promotional_access() ? 'code_digest' THEN RAISE EXCEPTION 'hash leaked'; END IF;
IF public.get_account_activation_eligibility()->>'access_kind'<>'promotion' THEN RAISE EXCEPTION 'gating'; END IF;
END $$;
SET request.jwt.claim.sub='{uid(39)}';
DO $$ BEGIN IF public.get_promotional_access() IS NOT NULL THEN RAISE EXCEPTION 'cross account'; END IF; END $$;
RESET ROLE;
DO $$ DECLARE t text; r text; BEGIN
FOREACH t IN ARRAY ARRAY['promotion_codes','promotional_access','promotion_attempts','promotion_campaign'] LOOP
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'RLS absent'; END IF;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'private table exposed'; END IF;
 END LOOP;
END LOOP;
IF has_function_privilege('authenticated','redeem_social_promotion(uuid,text)','EXECUTE') OR has_function_privilege('anon','install_social_promotion(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'mutation exposed'; END IF;
END $$;""")
        # Guardian save consumes the shared entitlement, unchanged selection rules.
        guardians = json.dumps([dict(name='Fixture', relationship='Friend', email=f'fixture{i}@example.invalid', id=None) for i in range(2)])
        assert json.loads(sql(f"SELECT save_guardian_selection('{uid(1)}','{{}}','{guardians}');"))['active'] is True
        print('PASS: 12 calendar months, access, reuse, concurrency, account uniqueness, paid preservation, initial/existing Check-in, expiry, rate limit, RLS, inventory idempotence, Guardian gating.')
    finally:
        if started:
            run('pg_ctl', '-D', base/'data', '-m', 'immediate', '-w', 'stop')

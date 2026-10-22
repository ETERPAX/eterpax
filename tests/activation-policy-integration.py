"""Disposable PostgreSQL only. Never connects to Supabase or sends messages."""
import os
import pathlib
import subprocess
import tempfile

BIN = pathlib.Path(os.environ.get('PG_BIN', '/usr/local/opt/postgresql@17/bin'))
ROOT = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='eterpax-policy-') as temp:
    base = pathlib.Path(temp)
    def run(name, *args, sql=None):
        result = subprocess.run([str(BIN / name), *map(str, args)], input=sql, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout
    run('initdb', '-D', base/'data', '-U', 'postgres', '-A', 'trust', '--no-locale')
    started = False
    try:
        run('pg_ctl', '-D', base/'data', '-l', base/'log', '-o', f"-k {base} -p 55452 -c listen_addresses=''", '-w', 'start')
        started = True
        def sql(text):
            return run('psql', '-X', '-h', base, '-p', '55452', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', sql=text)
        sql('''CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, created_at timestamptz NOT NULL);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.subscriptions(user_id uuid, status text);
CREATE TABLE public.guardian_plan_activations(user_id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001',now()), ('00000000-0000-0000-0000-000000000002',now());''')
        sql((ROOT/'supabase/migrations/202610210002_account_activation_policy.sql').read_text())
        # One transaction fixes transaction_timestamp for exact boundary assertions.
        print(sql('''BEGIN;
SET LOCAL timezone = 'UTC';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
CREATE FUNCTION public.assert_phase(expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
IF public.get_account_activation_eligibility()->>'status' <> expected THEN
RAISE EXCEPTION 'Expected %, got %',expected,public.get_account_activation_eligibility(); END IF;
END $$;
UPDATE public.account_activation_policy SET activated_at=now()-interval '100 days';
DO $$ DECLARE age interval; expected text; r jsonb; BEGIN
FOR age,expected IN SELECT * FROM (VALUES
(interval '0 days','preparation'), (interval '7 days','preparation'),
(interval '13 days','preparation'), (interval '15 days' - interval '1 microsecond','preparation'),
(interval '15 days','recovery'), (interval '16 days','recovery'),
(interval '30 days' - interval '1 microsecond','recovery'),
(interval '30 days','review_pending'),(interval '37 days','review_pending')) AS cases(age,expected)
LOOP
UPDATE auth.users SET created_at=now()-age WHERE id=auth.uid();
PERFORM public.assert_phase(expected);
r:=public.get_account_activation_eligibility();
IF (r->>'starts_at')::timestamptz <> now()-age OR
   (r->>'preparation_ends_at')::timestamptz <> now()-age+interval '15 days' OR
   (r->>'recovery_ends_at')::timestamptz <> now()-age+interval '30 days' THEN
RAISE EXCEPTION 'Incorrect deadlines'; END IF;
END LOOP; END $$;
-- Old accounts start from persisted activation, including later reads.
UPDATE auth.users SET created_at=now()-interval '365 days' WHERE id=auth.uid();
UPDATE public.account_activation_policy SET activated_at=now();
SELECT public.assert_phase('preparation');
DO $$ BEGIN IF (public.get_account_activation_eligibility()->>'preparation_ends_at')::timestamptz <> now()+interval '15 days' THEN RAISE EXCEPTION 'Old account lost preparation time'; END IF; END $$;
UPDATE public.account_activation_policy SET activated_at=now()-interval '15 days';
SELECT public.assert_phase('recovery');
UPDATE public.account_activation_policy SET activated_at=now()-interval '30 days';
SELECT public.assert_phase('review_pending');
-- Another account cannot affect this user's eligibility.
INSERT INTO public.subscriptions VALUES ('00000000-0000-0000-0000-000000000002','active');
SELECT public.assert_phase('review_pending');
INSERT INTO public.subscriptions VALUES (auth.uid(),'incomplete'),(auth.uid(),'incomplete_expired');
SELECT public.assert_phase('review_pending');
INSERT INTO public.subscriptions VALUES (auth.uid(),'canceled');
SELECT public.assert_phase('exempt_previous_subscriber');
INSERT INTO public.subscriptions VALUES (auth.uid(),'active');
SELECT public.assert_phase('active');
DO $$ BEGIN IF public.get_account_activation_eligibility()->>'preparation_ends_at' IS NOT NULL THEN RAISE EXCEPTION 'Active account has deadline'; END IF; END $$;
DELETE FROM public.subscriptions WHERE user_id=auth.uid();
INSERT INTO public.guardian_plan_activations VALUES (auth.uid());
SELECT public.assert_phase('exempt_previous_subscriber');
INSERT INTO public.subscriptions VALUES (auth.uid(),'active');
SELECT public.assert_phase('active');
DELETE FROM public.subscriptions WHERE user_id=auth.uid();
DELETE FROM public.guardian_plan_activations WHERE user_id=auth.uid();
INSERT INTO public.subscriptions VALUES (auth.uid(),'unknown_future_status');
SELECT public.assert_phase('exempt_previous_subscriber');
DELETE FROM public.subscriptions WHERE user_id=auth.uid();
SET LOCAL ROLE authenticated;
SELECT public.assert_phase('review_pending');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
SELECT public.assert_phase('active');
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
BEGIN PERFORM public.get_account_activation_eligibility(); RAISE EXCEPTION 'Missing auth accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
IF has_function_privilege('anon','public.get_account_activation_eligibility()','EXECUTE') OR
has_table_privilege('authenticated','public.account_activation_policy','UPDATE') OR
has_table_privilege('authenticated','public.account_activation_policy','SELECT') THEN RAISE EXCEPTION 'Unsafe permissions'; END IF;
IF (SELECT activated_at FROM public.account_activation_policy) <> now()-interval '30 days' THEN RAISE EXCEPTION 'Reads reset activation'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: exact day boundaries, old/new accounts, subscription priority/history, account isolation and permissions';''').splitlines()[-1])
    finally:
        if started:
            run('pg_ctl', '-D', base/'data', '-m', 'immediate', '-w', 'stop')

"""Disposable PostgreSQL cluster only; no production credentials or network."""
import pathlib
import subprocess
import tempfile

BIN = pathlib.Path('/usr/local/opt/postgresql@17/bin')
ROOT = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='eterpax-owner-claim-') as temp:
    base = pathlib.Path(temp)
    def run(name, *args, sql=None):
        return subprocess.run([str(BIN / name), *map(str, args)], input=sql,
                              text=True, capture_output=True, check=True).stdout
    run('initdb', '-D', base / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale')
    started = False
    try:
        run('pg_ctl', '-D', base / 'data', '-l', base / 'log', '-o',
            f"-k {base} -p 55439 -c listen_addresses=''", '-w', 'start')
        started = True
        def sql(text):
            return run('psql', '-X', '-h', base, '-p', '55439', '-U', 'postgres',
                       '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', sql=text)
        sql('''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.continuity_email_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, event_type text,
 delivery_status text, available_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
 lease_expires_at timestamptz, claim_token uuid, claimed_at timestamptz,
 last_attempt_at timestamptz, attempt_count integer DEFAULT 0, last_error text, updated_at timestamptz);
GRANT SELECT, UPDATE ON public.continuity_email_outbox TO service_role;
''')
        migration = (ROOT / 'supabase/migrations/202610120001_continuity_email_owner_claim.sql').read_text()
        sql(migration)
        sql(migration)  # Safe reapplication.
        sql('''
INSERT INTO public.continuity_email_outbox(user_id,event_type,delivery_status)
SELECT u, 'check_in_request','pending' FROM unnest(ARRAY[
 '11111111-1111-4111-8111-111111111111'::uuid,
 '00000000-0000-4000-8000-000000000001'::uuid]) u CROSS JOIN generate_series(1,3);
INSERT INTO public.continuity_email_outbox(user_id,event_type,delivery_status,lease_expires_at)
SELECT u,'check_in_request','processing',now()-interval '1 minute' FROM unnest(ARRAY[
 '11111111-1111-4111-8111-111111111111'::uuid,
 '00000000-0000-4000-8000-000000000001'::uuid]) u;
SET ROLE service_role;
DO $$ DECLARE n integer; lim integer; owner_id uuid := '11111111-1111-4111-8111-111111111111'; BEGIN
 FOREACH lim IN ARRAY ARRAY[NULL,0,3] LOOP
  BEGIN PERFORM public.claim_continuity_email_events_for_owner(owner_id,lim);
   RAISE EXCEPTION 'invalid limit accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 END LOOP;
 SELECT count(*) INTO n FROM public.claim_continuity_email_events_for_owner(owner_id,2);
 IF n <> 2 THEN RAISE EXCEPTION 'limit mismatch'; END IF;
 SELECT count(*) INTO n FROM public.claim_continuity_email_events_for_owner(owner_id,2);
 IF n <> 1 THEN RAISE EXCEPTION 'duplicate claim'; END IF;
 SELECT count(*) INTO n FROM public.claim_continuity_email_events_for_owner(owner_id,2);
 IF n <> 0 THEN RAISE EXCEPTION 'duplicate reclaim'; END IF;
 IF EXISTS (SELECT 1 FROM public.continuity_email_outbox WHERE user_id<>owner_id
 AND (attempt_count<>0 OR delivery_status NOT IN ('pending','processing'))) THEN
 RAISE EXCEPTION 'other owner modified'; END IF;
 IF (SELECT count(*) FROM public.continuity_email_outbox WHERE user_id=owner_id AND delivery_status='uncertain')<>1 THEN
 RAISE EXCEPTION 'lease recovery missing'; END IF;
 IF EXISTS (SELECT 1 FROM public.continuity_email_outbox WHERE user_id=owner_id AND delivery_status='processing'
 AND (claim_token IS NULL OR attempt_count<>1 OR lease_expires_at-claimed_at<>interval '10 minutes')) THEN
 RAISE EXCEPTION 'claim semantics changed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.claim_continuity_email_events_for_owner(uuid,integer)','EXECUTE')
 OR has_function_privilege('authenticated','public.claim_continuity_email_events_for_owner(uuid,integer)','EXECUTE') THEN
 RAISE EXCEPTION 'public execution allowed'; END IF;
END $$;
''')
        print('PASS: SQL install/reapply, service role, limits, owner isolation, lease recovery, no duplicate claims, ten-minute lease, restricted grants')
    finally:
        if started:
            run('pg_ctl', '-D', base / 'data', '-m', 'immediate', '-w', 'stop')

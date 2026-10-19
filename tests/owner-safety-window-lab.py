"""Disposable PostgreSQL cluster only; no production credentials or network."""
import pathlib
import subprocess
import tempfile

BIN = pathlib.Path('/usr/local/opt/postgresql@17/bin')
ROOT = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='eterpax-safety-mail-') as temp:
    base = pathlib.Path(temp)
    def run(name, *args, sql=None):
        return subprocess.run([str(BIN / name), *map(str, args)], input=sql,
                              text=True, capture_output=True, check=True).stdout
    run('initdb', '-D', base / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale')
    started = False
    try:
        run('pg_ctl', '-D', base / 'data', '-l', base / 'log', '-o',
            f"-k {base} -p 55449 -c listen_addresses=''", '-w', 'start')
        started = True
        def sql(text):
            return run('psql', '-X', '-h', base, '-p', '55449', '-U', 'postgres',
                       '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', sql=text)
        sql('''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.check_ins(id uuid PRIMARY KEY,user_id uuid,enabled boolean,status text,escalation_generation integer);
CREATE TABLE public.guardian_escalations(id uuid PRIMARY KEY,check_in_id uuid REFERENCES public.check_ins,user_id uuid,generation integer,status text,closed_at timestamptz,owner_checked_in_at timestamptz);
CREATE TABLE public.guardian_verification_rounds(escalation_id uuid PRIMARY KEY REFERENCES public.guardian_escalations,majority_reached_at timestamptz,safety_deadline_at timestamptz);
CREATE TABLE public.continuity_email_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,check_in_id uuid NOT NULL REFERENCES public.check_ins,
 event_type text NOT NULL CHECK(event_type='check_in_request'),response_deadline_at timestamptz NOT NULL,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),available_at timestamptz DEFAULT clock_timestamp(),
 created_at timestamptz DEFAULT clock_timestamp(),updated_at timestamptz DEFAULT clock_timestamp(),
 delivery_status text DEFAULT 'pending' CHECK(delivery_status IN ('pending','processing','sent','failed','cancelled','uncertain')),
 claim_token uuid,claimed_at timestamptz,lease_expires_at timestamptz,last_attempt_at timestamptz,last_error text,
 provider_message_id text,sent_at timestamptz,
 CHECK((delivery_status='processing' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND lease_expires_at>claimed_at)
 OR (delivery_status<>'processing' AND claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL)),
 UNIQUE(check_in_id,event_type,response_deadline_at));
GRANT SELECT,UPDATE ON public.continuity_email_outbox TO service_role;
''')
        sql((ROOT / 'supabase/migrations/202610190001_owner_safety_window_email.sql').read_text())
        sql('''
INSERT INTO public.check_ins SELECT gen_random_uuid(),gen_random_uuid(),true,'escalation_pending',1 FROM generate_series(1,3);
INSERT INTO public.guardian_escalations SELECT gen_random_uuid(),id,user_id,1,'waiting_for_responses',null,null FROM public.check_ins;
INSERT INTO public.guardian_verification_rounds SELECT id,now(),now()+interval '48 hours' FROM public.guardian_escalations;
UPDATE public.guardian_escalations SET status='safety_window';
DO $$ BEGIN IF (SELECT count(*) FROM public.continuity_email_outbox)<>3 THEN RAISE EXCEPTION 'transition enqueue failed'; END IF; END $$;
-- Missing legacy events must be delivered by this claim, not next hour's cron.
DELETE FROM public.continuity_email_outbox;
SET ROLE service_role;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.claim_continuity_email_events();
 IF n<>3 THEN RAISE EXCEPTION 'recovered rows excluded from same claim'; END IF;
END $$;
RESET ROLE;
UPDATE public.continuity_email_outbox SET delivery_status='pending',claim_token=null,claimed_at=null,lease_expires_at=null;
-- Model the missing legacy event, then recover it repeatedly without changing dates.
DELETE FROM public.continuity_email_outbox WHERE id=(SELECT id FROM public.continuity_email_outbox LIMIT 1);
SET ROLE service_role;
SELECT public.recover_owner_safety_window_emails(); SELECT public.recover_owner_safety_window_emails();
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.continuity_email_outbox)<>3 THEN RAISE EXCEPTION 'recovery not idempotent'; END IF;
 IF EXISTS(SELECT 1 FROM public.continuity_email_outbox o JOIN public.guardian_verification_rounds r USING(escalation_id) WHERE o.response_deadline_at<>r.safety_deadline_at) THEN RAISE EXCEPTION 'deadline changed'; END IF;
END $$;
UPDATE public.guardian_escalations SET status='cancelled_owner_check_in',closed_at=now(),owner_checked_in_at=now() WHERE id=(SELECT id FROM public.guardian_escalations LIMIT 1);
''')
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as workers:
            list(workers.map(lambda _: sql('SET ROLE service_role; SELECT count(*) FROM public.claim_continuity_email_events();'), range(2)))
        sql('''
DO $$ BEGIN
 IF (SELECT count(*) FROM public.continuity_email_outbox WHERE delivery_status='processing')<>2 THEN RAISE EXCEPTION 'claim duplicated/cancelled included'; END IF;
 IF (SELECT count(*) FROM public.continuity_email_outbox WHERE delivery_status='cancelled')<>1 THEN RAISE EXCEPTION 'cancellation missing'; END IF;
 IF has_function_privilege('authenticated','public.recover_owner_safety_window_emails()','EXECUTE') OR has_function_privilege('anon','public.claim_continuity_email_events()','EXECUTE') THEN RAISE EXCEPTION 'privilege leak'; END IF;
END $$;
UPDATE public.continuity_email_outbox SET claimed_at=now()-interval '20 minutes',lease_expires_at=now()-interval '10 minutes' WHERE delivery_status='processing';
SET ROLE service_role;
SELECT count(*) FROM public.claim_continuity_email_events(); SELECT public.recover_owner_safety_window_emails();
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM public.continuity_email_outbox WHERE delivery_status='uncertain')<>2 OR (SELECT count(*) FROM public.continuity_email_outbox)<>3 THEN RAISE EXCEPTION 'uncertain retried'; END IF; END $$;
''')
        print('PASS: transition, recovery, original deadline, cancellation, claims, uncertain/no retry, privileges')
    finally:
        if started:
            run('pg_ctl', '-D', base / 'data', '-m', 'immediate', '-w', 'stop')

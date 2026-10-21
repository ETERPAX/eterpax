"""Final integration: injected enqueue failures cannot reject signup; recovery is bounded by activation."""
import pathlib
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
BIN = pathlib.Path('/usr/local/opt/postgresql@17/bin')
ROOT = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='eterpax-welcome-integration-') as temp:
    base = pathlib.Path(temp)
    def run(name, *args, sql=None):
        result = subprocess.run([str(BIN / name), *map(str, args)], input=sql, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr)  # Synthetic local schema and data only.
        return result.stdout
    run('initdb', '-D', base/'data', '-U', 'postgres', '-A', 'trust', '--no-locale')
    started = False
    try:
        run('pg_ctl', '-D', base/'data', '-l', base/'log', '-o', f"-k {base} -p 55451 -c listen_addresses=''", '-w', 'start')
        started = True
        def sql(text):
            return run('psql', '-X', '-h', base, '-p', '55451', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', sql=text)
        sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text,raw_user_meta_data jsonb,is_anonymous boolean DEFAULT false,created_at timestamptz DEFAULT clock_timestamp());
INSERT INTO auth.users(email,raw_user_meta_data) VALUES('existing@example.invalid','{"firstName":"Existing"}');''')
        sql((ROOT/'supabase/migrations/202610210001_welcome_email.sql').read_text())
        sql('''CREATE FUNCTION public.inject_welcome_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Synthetic enqueue failure' USING ERRCODE=current_setting('test.enqueue_error'); END; $$;
CREATE TRIGGER inject_welcome_failure BEFORE INSERT ON public.welcome_emails FOR EACH ROW EXECUTE FUNCTION public.inject_welcome_failure();''')
        for number, code in enumerate(['23514', '42501', '42P01', '55P03', '57014']):
            sql(f"SET test.enqueue_error='{code}'; INSERT INTO auth.users(email,raw_user_meta_data) VALUES('new{number}@example.invalid','{{\"firstName\":\"Synthetic\"}}');")
        sql('''DO $$ BEGIN
IF (SELECT count(*) FROM auth.users)<>6 THEN RAISE EXCEPTION 'Enqueue failure blocked signup'; END IF;
IF EXISTS(SELECT 1 FROM public.welcome_emails) THEN RAISE EXCEPTION 'Failed enqueue unexpectedly persisted'; END IF;
END $$;
DROP TRIGGER inject_welcome_failure ON public.welcome_emails;
DROP FUNCTION public.inject_welcome_failure();''')
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _: sql('SET ROLE service_role; SELECT user_id FROM public.claim_welcome_email();'), range(2)))
        sql('''DO $$ BEGIN
IF (SELECT count(*) FROM public.welcome_emails)<>5 THEN RAISE EXCEPTION 'Recovery missing or duplicated rows'; END IF;
IF EXISTS(SELECT 1 FROM public.welcome_emails WHERE email='existing@example.invalid') THEN RAISE EXCEPTION 'Recovery welcomed old account'; END IF;
IF (SELECT count(*) FROM public.welcome_emails WHERE status='sending')<>2 THEN RAISE EXCEPTION 'Concurrent claims overlap'; END IF;
IF has_table_privilege('anon','public.welcome_email_activation','SELECT') OR has_table_privilege('authenticated','public.welcome_email_activation','UPDATE') THEN RAISE EXCEPTION 'Activation boundary is public'; END IF;
END $$;
UPDATE public.welcome_emails SET status='uncertain' WHERE status='sending';
UPDATE auth.users SET raw_user_meta_data='{"firstName":"Changed"}';
SELECT user_id FROM public.claim_welcome_email();
DO $$ BEGIN
IF (SELECT count(*) FROM public.welcome_emails)<>5 THEN RAISE EXCEPTION 'Profile update created welcome'; END IF;
IF (SELECT count(*) FROM public.welcome_emails WHERE status='uncertain')<>2 THEN RAISE EXCEPTION 'Recovery retried uncertain send'; END IF;
END $$;''')
        print('PASS: five injected enqueue errors preserve signup; concurrent recovery is unique; old accounts and uncertain sends stay excluded.')
    finally:
        if started:
            run('pg_ctl', '-D', base/'data', '-m', 'immediate', '-w', 'stop')

"""Disposable PostgreSQL only: real trigger, permissions and concurrent claims."""
import pathlib
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor

BIN = pathlib.Path('/usr/local/opt/postgresql@17/bin')
ROOT = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='eterpax-welcome-') as temp:
    base = pathlib.Path(temp)
    def run(name, *args, sql=None):
        return subprocess.run([str(BIN / name), *map(str, args)], input=sql,
                              text=True, capture_output=True, check=True).stdout
    run('initdb', '-D', base / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale')
    started = False
    try:
        run('pg_ctl', '-D', base / 'data', '-l', base / 'log', '-o',
            f"-k {base} -p 55450 -c listen_addresses=''", '-w', 'start')
        started = True
        def sql(text):
            return run('psql', '-X', '-h', base, '-p', '55450', '-U', 'postgres',
                       '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', sql=text)
        sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text, raw_user_meta_data jsonb, is_anonymous boolean DEFAULT false, created_at timestamptz DEFAULT clock_timestamp());
INSERT INTO auth.users(email,raw_user_meta_data) VALUES('existing@example.invalid','{"firstName":"Existing"}');''')
        sql((ROOT / 'supabase/migrations/202610210001_welcome_email.sql').read_text())
        sql('''
UPDATE auth.users SET raw_user_meta_data='{"firstName":"Updated"}';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.welcome_emails) THEN RAISE EXCEPTION 'existing user enqueued'; END IF; END $$;
INSERT INTO auth.users(email,raw_user_meta_data) SELECT 'new'||n||'@example.invalid',jsonb_build_object('firstName','Person '||n) FROM generate_series(1,8) n;
UPDATE auth.users SET raw_user_meta_data='{"firstName":"Updated"}';
INSERT INTO auth.users(email,raw_user_meta_data,is_anonymous) VALUES('anonymous@example.invalid','{}',true),(NULL,'{}',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.welcome_emails)<>8 THEN RAISE EXCEPTION 'wrong number of welcomes'; END IF;
 IF EXISTS(SELECT 1 FROM public.welcome_emails WHERE first_name='Updated') THEN RAISE EXCEPTION 'profile update changed snapshot'; END IF;
 IF has_table_privilege('authenticated','public.welcome_emails','SELECT') OR has_table_privilege('anon','public.welcome_emails','INSERT') OR has_table_privilege('service_role','public.welcome_emails','UPDATE') THEN RAISE EXCEPTION 'table access leak'; END IF;
 IF has_function_privilege('authenticated','public.claim_welcome_email()','EXECUTE') OR has_function_privilege('anon','public.finish_welcome_email(uuid,uuid,text)','EXECUTE') OR has_function_privilege('service_role','public.enqueue_new_account_welcome()','EXECUTE') THEN RAISE EXCEPTION 'RPC permission leak'; END IF;
END $$;''')
        with ThreadPoolExecutor(max_workers=8) as pool:
            claims = list(pool.map(lambda _: sql('SET ROLE service_role; SELECT user_id FROM public.claim_welcome_email();'), range(8)))
        ids = [line for output in claims for line in output.splitlines() if len(line) == 36]
        assert len(ids) == len(set(ids)) == 8, claims
        sql('''
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM public.welcome_emails LOOP
  IF public.finish_welcome_email(r.user_id,gen_random_uuid(),'accepted') THEN RAISE EXCEPTION 'wrong claim accepted'; END IF;
  IF NOT public.finish_welcome_email(r.user_id,r.claim_token,'accepted') THEN RAISE EXCEPTION 'finish failed'; END IF;
  IF public.finish_welcome_email(r.user_id,r.claim_token,'accepted') THEN RAISE EXCEPTION 'duplicate finish'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.claim_welcome_email()) THEN RAISE EXCEPTION 'duplicate claim'; END IF;
END $$;
INSERT INTO auth.users(email,raw_user_meta_data) VALUES('crash@example.invalid','{"firstName":"Crash"}');
SELECT user_id FROM public.claim_welcome_email();
UPDATE public.welcome_emails SET claimed_at=clock_timestamp()-interval '25 hours' WHERE status='sending';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.claim_welcome_email()) THEN RAISE EXCEPTION 'ambiguous send retried'; END IF;
 IF (SELECT status FROM public.welcome_emails WHERE email='crash@example.invalid')<>'uncertain' THEN RAISE EXCEPTION 'stale attempt not classified'; END IF;
END $$;
DELETE FROM auth.users WHERE email='crash@example.invalid';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.welcome_emails WHERE email='crash@example.invalid') THEN RAISE EXCEPTION 'delete did not cascade'; END IF; END $$;
''')
        print('PASS: new accounts only, immutable snapshots, eight concurrent unique claims, role isolation, claim ownership, no retries, cascade deletion')
    finally:
        if started:
            run('pg_ctl', '-D', base / 'data', '-m', 'immediate', '-w', 'stop')

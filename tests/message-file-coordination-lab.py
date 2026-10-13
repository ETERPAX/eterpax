"""Disposable PostgreSQL fixtures. No production connection or Storage deletion."""
import pathlib, subprocess, tempfile
BIN = pathlib.Path('/usr/local/opt/postgresql@17/bin')
ROOT = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='eterpax-message-files-') as temp:
    base = pathlib.Path(temp)
    def run(name, *args, sql=None):
        result = subprocess.run([str(BIN/name), *map(str,args)], input=sql, text=True,capture_output=True)
        if result.returncode: raise RuntimeError(result.stderr)
        return result.stdout
    run('initdb','-D',base/'data','-U','postgres','-A','trust','--no-locale')
    started=False
    try:
        run('pg_ctl','-D',base/'data','-l',base/'log','-o',f"-k {base} -p 55441 -c listen_addresses=''",'-w','start');started=True
        def sql(text): return run('psql','-X','-h',base,'-p','55441','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1',sql=text)
        sql('''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.messages(id uuid PRIMARY KEY,user_id uuid NOT NULL,status text DEFAULT 'draft',body text,voice_path text,video_path text,document_path text);
CREATE TABLE public.check_ins(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,status text,missed_count integer);
CREATE TABLE public.guardian_escalations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,status text,closed_at timestamptz);
INSERT INTO public.check_ins(user_id,status,missed_count) VALUES('50cc8dbe-be5a-460b-9e00-429acdcf9563','scheduled',0);
CREATE TABLE public.message_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid REFERENCES messages(id) ON DELETE CASCADE,user_id uuid,storage_path text);
CREATE TABLE public.message_videos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid REFERENCES messages(id) ON DELETE CASCADE,user_id uuid,video_path text);
CREATE TABLE public.message_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid REFERENCES messages(id) ON DELETE CASCADE,user_id uuid,document_path text);
CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text, UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public,storage,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,storage TO authenticated;
CREATE POLICY fixture_owner ON storage.objects FOR ALL TO authenticated USING(split_part(name,'/',1)=auth.uid()::text) WITH CHECK(split_part(name,'/',1)=auth.uid()::text);
INSERT INTO messages(id,user_id,voice_path) VALUES
 ('00000000-0000-4000-8000-000000000011','50cc8dbe-be5a-460b-9e00-429acdcf9563','50cc8dbe-be5a-460b-9e00-429acdcf9563/legacy.webm'),
 ('00000000-0000-4000-8000-000000000012','50cc8dbe-be5a-460b-9e00-429acdcf9563','50cc8dbe-be5a-460b-9e00-429acdcf9563/legacy.webm');
''')
        sql((ROOT/'supabase/migrations/202610130001_message_file_coordination.sql').read_text())
        sql((ROOT/'supabase/migrations/202610130002_message_cleanup_verification.sql').read_text())
        sql((ROOT/'supabase/migrations/202610130003_controlled_message_deletion.sql').read_text())
        sql("""
-- Legacy clients work before enrollment, and continue working for other owners.
SET request.jwt.claim.sub='50cc8dbe-be5a-460b-9e00-429acdcf9563'; SET ROLE authenticated;
INSERT INTO storage.objects(bucket_id,name) VALUES('message-audio','50cc8dbe-be5a-460b-9e00-429acdcf9563/legacy-before-enrollment');
RESET ROLE;
UPDATE message_file_rollout SET coordination_enabled=true,delete_enabled=true,private_delivery_reviewed_disabled=true;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'; SET ROLE authenticated;
INSERT INTO storage.objects(bucket_id,name) VALUES('message-audio','00000000-0000-4000-8000-000000000002/legacy-after-enrollment');
RESET ROLE;
""")
        sql('''
SET request.jwt.claim.sub='50cc8dbe-be5a-460b-9e00-429acdcf9563';
SET ROLE authenticated;
SELECT public.register_message_upload('00000000-0000-4000-8000-000000000011','message-audio','00000000-0000-4000-8000-000000000021');
-- Idempotent registration, same unique path.
SELECT public.register_message_upload('00000000-0000-4000-8000-000000000011','message-audio','00000000-0000-4000-8000-000000000021');
INSERT INTO storage.objects(bucket_id,name) VALUES('message-audio','50cc8dbe-be5a-460b-9e00-429acdcf9563/00000000-0000-4000-8000-000000000011/00000000-0000-4000-8000-000000000021');
SELECT public.complete_message_upload('00000000-0000-4000-8000-000000000021');
UPDATE messages SET voice_path='50cc8dbe-be5a-460b-9e00-429acdcf9563/00000000-0000-4000-8000-000000000011/00000000-0000-4000-8000-000000000021' WHERE id='00000000-0000-4000-8000-000000000011';
DO $$ BEGIN
 BEGIN UPDATE messages SET deletion_state='deleting' WHERE id='00000000-0000-4000-8000-000000000011'; RAISE EXCEPTION 'state bypass'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='state bypass' THEN RAISE; END IF; END;
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('message-audio','50cc8dbe-be5a-460b-9e00-429acdcf9563/unregistered'); RAISE EXCEPTION 'policy bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT public.begin_message_deletion('00000000-0000-4000-8000-000000000011');
CREATE TEMP TABLE claimed AS SELECT * FROM public.claim_message_file_cleanup(10);
DO $$ BEGIN
 IF (SELECT count(*) FROM claimed)<>1 THEN RAISE EXCEPTION 'shared file selected or missing cleanup'; END IF;
 IF NOT EXISTS(SELECT 1 FROM message_file_cleanup WHERE outcome='retained_shared') THEN RAISE EXCEPTION 'legacy shared path lost'; END IF;
 IF EXISTS(SELECT 1 FROM public.claim_message_file_cleanup(10)) THEN RAISE EXCEPTION 'duplicate live lease'; END IF;
END $$;
SELECT public.finish_message_file_cleanup(message_id,bucket,path,claim_token,false) FROM claimed;
UPDATE message_file_cleanup SET next_attempt_at=now()-interval '1 minute';
SELECT * FROM public.claim_message_file_cleanup(10);
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN UPDATE messages SET body='changed' WHERE id='00000000-0000-4000-8000-000000000011'; RAISE EXCEPTION 'editing allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='editing allowed' THEN RAISE; END IF; END;
 BEGIN PERFORM public.register_message_upload('00000000-0000-4000-8000-000000000011','message-audio',gen_random_uuid()); RAISE EXCEPTION 'registration allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='registration allowed' THEN RAISE; END IF; END;
END $$;
''')
        sql("""
INSERT INTO messages(id,user_id) VALUES('00000000-0000-4000-8000-000000000013','50cc8dbe-be5a-460b-9e00-429acdcf9563');
SET request.jwt.claim.sub='50cc8dbe-be5a-460b-9e00-429acdcf9563';
SELECT register_message_upload('00000000-0000-4000-8000-000000000013','message-audio','00000000-0000-4000-8000-000000000023');
""")
        writer = subprocess.Popen([str(BIN/'psql'),'-X','-At','-h',str(base),'-p','55441','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        writer.stdin.write("""BEGIN;
SET request.jwt.claim.sub='50cc8dbe-be5a-460b-9e00-429acdcf9563';
SET ROLE authenticated;
INSERT INTO storage.objects(bucket_id,name) VALUES('message-audio','50cc8dbe-be5a-460b-9e00-429acdcf9563/00000000-0000-4000-8000-000000000013/00000000-0000-4000-8000-000000000023');
SELECT 'LOCK_READY';
SELECT pg_sleep(1);
COMMIT;
"""); writer.stdin.close()
        while True:
            line=writer.stdout.readline()
            if not line: raise RuntimeError(writer.stderr.read())
            if line.strip()=='LOCK_READY': break
        sql("""
SET request.jwt.claim.sub='50cc8dbe-be5a-460b-9e00-429acdcf9563';
SELECT begin_message_deletion('00000000-0000-4000-8000-000000000013');
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM message_file_cleanup WHERE message_id='00000000-0000-4000-8000-000000000013') THEN RAISE EXCEPTION 'concurrent upload lost'; END IF;
 BEGIN PERFORM complete_message_upload('00000000-0000-4000-8000-000000000023'); RAISE EXCEPTION 'late attachment permitted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='late attachment permitted' THEN RAISE; END IF; END;
END $$;
""")
        if writer.wait(timeout=5)!=0: raise RuntimeError(writer.stderr.read())
        sql("""
SET request.jwt.claim.sub='50cc8dbe-be5a-460b-9e00-429acdcf9563';
SELECT register_message_upload('00000000-0000-4000-8000-000000000012','message-documents','00000000-0000-4000-8000-000000000024');
UPDATE message_upload_operations SET expires_at=now()-interval '1 second' WHERE id='00000000-0000-4000-8000-000000000024';
SELECT * FROM claim_message_file_cleanup(10);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM message_upload_operations WHERE id='00000000-0000-4000-8000-000000000024' AND state='failed')
 OR NOT EXISTS(SELECT 1 FROM message_file_cleanup WHERE path LIKE '%00000000-0000-4000-8000-000000000024') THEN RAISE EXCEPTION 'interrupted upload lost'; END IF;
END $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM register_message_upload('00000000-0000-4000-8000-000000000012','message-audio',gen_random_uuid()); RAISE EXCEPTION 'owner bypass'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='owner bypass' THEN RAISE; END IF; END;
END $$;
""")
        sql("""
RESET ROLE;
DO $$ DECLARE c public.message_file_cleanup%rowtype; result text; BEGIN
 SELECT * INTO c FROM message_file_cleanup WHERE path LIKE '%00000000-0000-4000-8000-000000000021';
 result:=verify_message_file_cleanup(c.message_id,c.bucket,c.path,c.claim_token,'before');
 IF result<>'ready' THEN RAISE EXCEPTION 'preflight failed %',result; END IF;
 result:=verify_message_file_cleanup(c.message_id,c.bucket,c.path,c.claim_token,'after');
 IF result<>'present' THEN RAISE EXCEPTION 'unverified absence %',result; END IF;
 -- Fixture metadata only: simulate Storage confirmation; there are no real files.
 DELETE FROM storage.objects WHERE bucket_id=c.bucket AND name=c.path;
 result:=verify_message_file_cleanup(c.message_id,c.bucket,c.path,c.claim_token,'after');
 IF result<>'absent' THEN RAISE EXCEPTION 'absence not reconciled %',result; END IF;
 result:=verify_message_file_cleanup(c.message_id,c.bucket,c.path,c.claim_token,'before');
 IF result<>'lost' THEN RAISE EXCEPTION 'old token reusable'; END IF;
 UPDATE message_file_cleanup SET claim_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes' WHERE path LIKE '%legacy.webm' RETURNING * INTO c;
 result:=verify_message_file_cleanup(c.message_id,c.bucket,c.path,c.claim_token,'before');
 IF result<>'blocked' THEN RAISE EXCEPTION 'shared path allowed'; END IF;
 IF has_function_privilege('authenticated','public.verify_message_file_cleanup(uuid,text,text,uuid,text)','EXECUTE') OR has_function_privilege('anon','public.verify_message_file_cleanup(uuid,text,text,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'verification exposed'; END IF;
 IF NOT has_function_privilege('service_role','public.verify_message_file_cleanup(uuid,text,text,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'service denied'; END IF;
END $$;
""")
        sql("""
INSERT INTO message_file_cleanup(message_id,user_id,bucket,path,next_attempt_at) VALUES
('00000000-0000-4000-8000-000000000031','50cc8dbe-be5a-460b-9e00-429acdcf9563','message-audio','50cc8dbe-be5a-460b-9e00-429acdcf9563/duplicate-path',now()-interval '1 year'),
('00000000-0000-4000-8000-000000000032','50cc8dbe-be5a-460b-9e00-429acdcf9563','message-audio','50cc8dbe-be5a-460b-9e00-429acdcf9563/duplicate-path',now()-interval '1 year');
SELECT * FROM claim_message_file_cleanup(2);
SELECT * FROM claim_message_file_cleanup(2);
DO $$ BEGIN
 IF (SELECT count(*) FROM message_file_cleanup WHERE path LIKE '%duplicate-path' AND lease_expires_at>clock_timestamp())<>1 THEN RAISE EXCEPTION 'overlapping physical leases'; END IF;
END $$;
""")
        sql("""
DO $$ BEGIN
 IF has_function_privilege('authenticated','public.request_test_message_deletion(uuid,uuid)','EXECUTE') OR has_function_privilege('anon','public.finalize_test_message_deletion(uuid,uuid)','EXECUTE') OR has_function_privilege('service_role','public.begin_message_deletion(uuid)','EXECUTE') THEN RAISE EXCEPTION 'unsafe grant'; END IF;
 BEGIN UPDATE message_file_rollout SET coordination_enabled=false; RAISE EXCEPTION 'unsafe rollback'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='unsafe rollback' THEN RAISE; END IF; END;
END $$;
INSERT INTO messages(id,user_id) VALUES('00000000-0000-4000-8000-000000000041','50cc8dbe-be5a-460b-9e00-429acdcf9563');
INSERT INTO message_photos(message_id,user_id) VALUES('00000000-0000-4000-8000-000000000041','50cc8dbe-be5a-460b-9e00-429acdcf9563');
UPDATE check_ins SET missed_count=1;
DO $$ BEGIN
 BEGIN PERFORM request_test_message_deletion('50cc8dbe-be5a-460b-9e00-429acdcf9563','00000000-0000-4000-8000-000000000041'); RAISE EXCEPTION 'miss bypass'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='miss bypass' THEN RAISE; END IF; END;
END $$;
UPDATE check_ins SET missed_count=0;
INSERT INTO guardian_escalations(user_id,status) VALUES('50cc8dbe-be5a-460b-9e00-429acdcf9563','waiting_for_responses');
DO $$ BEGIN
 IF message_deletion_safe('50cc8dbe-be5a-460b-9e00-429acdcf9563') THEN RAISE EXCEPTION 'escalation bypass'; END IF;
 IF EXISTS(SELECT * FROM claim_test_message_file_cleanup(2)) THEN RAISE EXCEPTION 'unsafe cleanup'; END IF;
END $$;
-- Fixture-only cancellation; never performed by the application.
UPDATE guardian_escalations SET status='cancelled_owner_check_in',closed_at=now();
SELECT request_test_message_deletion('50cc8dbe-be5a-460b-9e00-429acdcf9563','00000000-0000-4000-8000-000000000041');
DO $$ BEGIN
 IF finalize_test_message_deletion('50cc8dbe-be5a-460b-9e00-429acdcf9563','00000000-0000-4000-8000-000000000041')<>'deleted' THEN RAISE EXCEPTION 'empty draft finalization'; END IF;
 IF EXISTS(SELECT 1 FROM message_photos WHERE message_id='00000000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'cascade failed'; END IF;
 IF finalize_test_message_deletion('50cc8dbe-be5a-460b-9e00-429acdcf9563','00000000-0000-4000-8000-000000000041')<>'deleted' THEN RAISE EXCEPTION 'retry failed'; END IF;
 IF finalize_test_message_deletion('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000041')<>'blocked' THEN RAISE EXCEPTION 'owner bypass'; END IF;
 IF finalize_test_message_deletion('50cc8dbe-be5a-460b-9e00-429acdcf9563','00000000-0000-4000-8000-000000000013')<>'pending' THEN RAISE EXCEPTION 'premature metadata delete'; END IF;
 IF finalize_test_message_deletion('50cc8dbe-be5a-460b-9e00-429acdcf9563','00000000-0000-4000-8000-000000000011')<>'deleted' THEN RAISE EXCEPTION 'shared retention finalization'; END IF;
 IF NOT EXISTS(SELECT 1 FROM messages WHERE id='00000000-0000-4000-8000-000000000012' AND voice_path LIKE '%legacy.webm') THEN RAISE EXCEPTION 'other message changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM message_file_cleanup WHERE message_id='00000000-0000-4000-8000-000000000011') THEN RAISE EXCEPTION 'inventory lost'; END IF;
 BEGIN PERFORM claim_test_message_file_cleanup(3); RAISE EXCEPTION 'limit bypass'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='limit bypass' THEN RAISE; END IF; END;
END $$;
""")
        sql("""
INSERT INTO message_file_cleanup(message_id,user_id,bucket,path,next_attempt_at) VALUES('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000002','message-audio','00000000-0000-4000-8000-000000000002/other-owner',now()-interval '1 year');
UPDATE message_file_cleanup SET claim_token=NULL,lease_expires_at=NULL,next_attempt_at=now()-interval '1 second' WHERE message_id='00000000-0000-4000-8000-000000000013';
CREATE TEMP TABLE scoped_claim AS SELECT * FROM claim_test_message_file_cleanup(2,'00000000-0000-4000-8000-000000000013');
DO $$ BEGIN
 IF (SELECT count(*) FROM scoped_claim)<>1 OR EXISTS(SELECT 1 FROM scoped_claim WHERE message_id<>'00000000-0000-4000-8000-000000000013') THEN RAISE EXCEPTION 'message scope violated'; END IF;
 IF EXISTS(SELECT 1 FROM message_file_cleanup WHERE message_id='00000000-0000-4000-8000-000000000099' AND claim_token IS NOT NULL) THEN RAISE EXCEPTION 'owner scope violated'; END IF;
END $$;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';
DO $$ BEGIN
 BEGIN INSERT INTO messages(id,user_id,voice_path) VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','50cc8dbe-be5a-460b-9e00-429acdcf9563/legacy.webm'); RAISE EXCEPTION 'retiring reference accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='retiring reference accepted' THEN RAISE; END IF; END;
END $$;
""")
        sql((ROOT/'tests/message-multiuser-fixtures.sql').read_text())
        sql((ROOT/'supabase/migrations/202610130004_multiuser_message_deletion.sql').read_text())
        sql((ROOT/'tests/message-multiuser-assertions.sql').read_text())
        sql("""
UPDATE message_file_cleanup SET next_attempt_at=now()+interval '1 day';
INSERT INTO message_file_cleanup(message_id,user_id,bucket,path) VALUES
('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000002','message-audio','00000000-0000-4000-8000-000000000002/concurrent'),
('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000004','message-audio','00000000-0000-4000-8000-000000000004/concurrent');
""")
        worker = subprocess.Popen([str(BIN/'psql'),'-X','-At','-h',str(base),'-p','55441','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        worker.stdin.write("BEGIN; SELECT count(*) FROM claim_message_file_cleanup_scoped(1); SELECT 'CLAIM_READY'; SELECT pg_sleep(1); COMMIT;\n");worker.stdin.close()
        while True:
            line=worker.stdout.readline()
            if not line: raise RuntimeError(worker.stderr.read())
            if line.strip()=='CLAIM_READY': break
        sql("SELECT count(*) FROM claim_message_file_cleanup_scoped(1);")
        if worker.wait(timeout=5)!=0: raise RuntimeError(worker.stderr.read())
        sql("""DO $$ BEGIN
 IF (SELECT count(*) FROM message_file_cleanup WHERE path LIKE '%/concurrent' AND claim_token IS NOT NULL)<>2 THEN RAISE EXCEPTION 'concurrent multiuser workers lost/duplicated claim'; END IF;
END $$;""")
        print('PASS MULTIUSER CONCURRENCY: two simultaneous PostgreSQL workers claim distinct owners/jobs')
        print('PASS MULTIUSER: incremental preservation, no enrollment rows, owner isolation/RLS, global claims, shared files, automatic finalization, late arrivals and verification gates')
        print('PASS: gradual enrollment, disabled rollback bypass, continuity gate, finalization, cascades, shared retention and idempotent retry')
        print('PASS: before/after verification, shared references, absent metadata, stale token, service-only grants')
        print('PASS: concurrent Storage metadata insert/deletion preserves inventory and blocks late completion')
        print('PASS SQL: registration, RLS fence, attachment, legacy shared paths, deletion fence, claim leases and retry')
    finally:
        if started: run('pg_ctl','-D',base/'data','-m','immediate','-w','stop')

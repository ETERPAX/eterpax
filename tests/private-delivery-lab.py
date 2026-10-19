"""Real PostgreSQL 17, disposable Unix-socket-only cluster. Never reads .env or connects remotely."""
import pathlib, subprocess, tempfile, uuid, json, concurrent.futures, os, re
ROOT=pathlib.Path(__file__).resolve().parents[1]
BIN=pathlib.Path('/usr/local/opt/postgresql@17/bin')
ENV={k:v for k,v in os.environ.items() if not k.startswith('PG')}
ENV['PGPASSFILE']='/dev/null'
with tempfile.TemporaryDirectory(prefix='eterpax-release-') as tmp:
 base=pathlib.Path(tmp)
 def run(tool,*args,sql=None,check=True):
  r=subprocess.run([str(BIN/tool),*map(str,args)],input=sql,text=True,capture_output=True,env=ENV)
  if check and r.returncode: raise RuntimeError(r.stderr)
  return r.stdout.strip() if check else r
 run('initdb','-D',base/'data','-U','postgres','-A','trust','--no-locale')
 started=False
 try:
  run('pg_ctl','-D',base/'data','-l',base/'log','-o',f"-k {base} -p 55449 -c listen_addresses=''",'-w','start');started=True
  def sql(s,check=True):return run('psql','-X','-qAt','-h',base,'-p','55449','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1',sql=s,check=check)
  def ok(expr,label):
   assert sql('SELECT ('+expr+');')=='t',label
   print('PASS',label,flush=True)
  def denied(s,label):
   assert sql(s,False).returncode!=0,label
   print('PASS',label,flush=True)
  sql('''
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,recipient_name text,recipient_email text,body text,status text DEFAULT 'draft',created_at timestamptz DEFAULT now(),voice_path text,video_path text,document_path text);
CREATE TABLE check_ins(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL UNIQUE,enabled boolean DEFAULT true,status text DEFAULT 'escalation_pending',missed_count integer DEFAULT 3,escalation_generation bigint DEFAULT 1,last_check_in_at timestamptz,next_check_in_at timestamptz,response_deadline_at timestamptz,frequency_days integer DEFAULT 7,updated_at timestamptz);
CREATE TABLE guardian_escalations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),check_in_id uuid REFERENCES check_ins(id),user_id uuid,generation bigint DEFAULT 1,status text DEFAULT 'safety_window',created_at timestamptz DEFAULT now(),closed_at timestamptz,owner_checked_in_at timestamptz,
 CONSTRAINT guardian_escalations_status_check CHECK(status IN ('safety_window','cancelled_owner_check_in')),
 CONSTRAINT guardian_escalations_closed_at_check CHECK(true), CONSTRAINT guardian_escalations_owner_check_in_check CHECK(true));
CREATE TABLE guardian_verification_rounds(escalation_id uuid PRIMARY KEY REFERENCES guardian_escalations(id),majority_reached_at timestamptz,safety_deadline_at timestamptz,dispatch_exhausted_at timestamptz,
 CHECK(safety_deadline_at=majority_reached_at+interval '48 hours'));
CREATE TABLE guardian_escalation_participants(escalation_id uuid,source_guardian_id uuid,PRIMARY KEY(escalation_id,source_guardian_id));
CREATE TABLE guardian_verification_responses(escalation_id uuid,source_guardian_id uuid,decision text,responded_at timestamptz,PRIMARY KEY(escalation_id,source_guardian_id));
CREATE TABLE guardian_verification_notifications(id uuid,escalation_id uuid,status text);
CREATE TABLE guardian_verification_emission_attempts(notification_id uuid,status text);
CREATE TABLE message_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid REFERENCES messages(id),user_id uuid,storage_path text);
CREATE TABLE message_videos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid REFERENCES messages(id),user_id uuid,video_path text);
CREATE TABLE message_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid REFERENCES messages(id),user_id uuid,document_path text);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb DEFAULT '{"size":128}',UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public,storage TO authenticated,service_role;
CREATE POLICY fixture_storage ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
''')
  for table,prefixes in [('messages',['body','voice','video','document']),('message_photos',['photo']),('message_videos',['video']),('message_documents',['document'])]:
   for prefix in prefixes:
    sql(f'ALTER TABLE {table} ADD COLUMN {prefix}_iv text,ADD COLUMN {prefix}_encrypted_key text,ADD COLUMN {prefix}_encryption_version text,ADD COLUMN {prefix}_mime_type text;')
  for name in ['202610130001_message_file_coordination.sql','202610130002_message_cleanup_verification.sql','202610130003_controlled_message_deletion.sql','202610130004_multiuser_message_deletion.sql','202610190002_private_message_release.sql']:
   sql((ROOT/'supabase/migrations'/name).read_text())
  owner_sql=(ROOT/'supabase/migrations/202610090002_guardian_verification_emissions_owner_compatibility.sql').read_text()
  sql(re.search(r'create or replace function public.confirm_check_in\(\).*?\$function\$;',owner_sql,re.S|re.I).group())
  def fixture(due=True,positive=3,messages=1,email='friend@example.invalid'):
   u,c,e=[str(uuid.uuid4()) for _ in range(3)]
   t="now()-interval '49 hours'" if due else 'now()'
   sql(f"INSERT INTO check_ins(id,user_id) VALUES('{c}','{u}');INSERT INTO guardian_escalations(id,check_in_id,user_id) VALUES('{e}','{c}','{u}');INSERT INTO guardian_verification_rounds VALUES('{e}',{t},{t}+interval '48 hours',NULL);")
   for i in range(5):
    g=str(uuid.uuid4());sql(f"INSERT INTO guardian_escalation_participants VALUES('{e}','{g}');"+(f"INSERT INTO guardian_verification_responses VALUES('{e}','{g}','positive',(SELECT majority_reached_at FROM guardian_verification_rounds WHERE escalation_id='{e}'));" if i<positive else ''))
   ids=[]
   for i in range(messages):
    mid=str(uuid.uuid4());ids.append(mid);sql(f"INSERT INTO messages(id,user_id,recipient_email,body) VALUES('{mid}','{u}','{email}','Private letter {i}');")
   return u,c,e,ids
  def process():return sql('SELECT outcome FROM process_private_message_releases();')
  f=fixture();ok("NOT EXISTS(SELECT 1 FROM process_private_message_releases())",'disabled by default')
  sql('UPDATE private_delivery_settings SET release_enabled=true,delivery_enabled=true;')
  print('first result',process())
  ok(f"EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{f[2]}')",'due window releases')
  process();ok(f"(SELECT count(*)=1 FROM message_releases WHERE escalation_id='{f[2]}')",'duplicate cron idempotent')
  denied(f"UPDATE messages SET body='changed' WHERE id='{f[3][0]}';",'released content immutable')
  denied('SET ROLE authenticated; SELECT * FROM message_releases;', 'browser cannot read release records')
  denied('SET ROLE authenticated; SELECT process_private_message_releases();','browser cannot run release')
  denied('SET ROLE service_role; UPDATE recipient_deliveries SET status=\'accepted\';','service role cannot bypass delivery RPC')
  future=fixture(False);process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{future[2]}')",'future deadline blocked')
  weak=fixture(positive=2);process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{weak[2]}')",'strict majority enforced')
  wrong=fixture();sql(f"UPDATE check_ins SET escalation_generation=2 WHERE id='{wrong[1]}';");process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{wrong[2]}')",'wrong generation blocked')
  cancel=fixture();sql(f"SET request.jwt.claim.sub='{cancel[0]}'; SELECT confirm_check_in();");process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{cancel[2]}')",'real owner cancellation blocks late cron')
  checked=fixture();sql(f"UPDATE check_ins SET last_check_in_at=now() WHERE id='{checked[1]}';");process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{checked[2]}')",'later owner confirmation blocked')
  group=fixture(messages=3,email='Friend@Example.invalid');other=str(uuid.uuid4());sql(f"INSERT INTO messages(id,user_id,recipient_email,body) VALUES('{other}','{group[0]}','second@example.invalid','other recipient');")
  assetpath=group[0]+'/photo.png';sql(f"INSERT INTO storage.objects(bucket_id,name) VALUES('message-photos','{assetpath}'); INSERT INTO message_photos(message_id,user_id,storage_path) VALUES('{group[3][0]}','{group[0]}','{assetpath}');")
  process();ok(f"(SELECT count(*)=2 FROM message_release_recipients rr JOIN message_releases r ON r.id=rr.release_id WHERE r.escalation_id='{group[2]}')",'multiple messages grouped per normalized email')
  ok(f"(SELECT count(*)=3 FROM message_release_items i JOIN message_release_recipients rr ON rr.id=i.recipient_id JOIN message_releases r ON r.id=rr.release_id WHERE r.escalation_id='{group[2]}' AND rr.email='friend@example.invalid')",'group contains every authorized message')
  denied(f"DELETE FROM storage.objects WHERE name='{assetpath}';",'released storage cannot be deleted')
  denied(f"UPDATE storage.objects SET metadata='{{}}' WHERE name='{assetpath}';",'released storage cannot be overwritten')
  missing=fixture();sql(f"UPDATE messages SET voice_path='missing' WHERE id='{missing[3][0]}';");process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{missing[2]}')",'missing attachment rolls back whole release')
  malformed=fixture();sql(f"UPDATE messages SET body_encryption_version='v1' WHERE id='{malformed[3][0]}';");process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{malformed[2]}')",'incomplete encryption blocks release')
  concurrent_case=fixture(messages=2)
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(lambda _:process(),range(2)))
  ok(f"(SELECT count(*)=1 FROM message_releases WHERE escalation_id='{concurrent_case[2]}')",'two simultaneous cron connections release once')
  # Real claim/reserve/finish lifecycle and digest access.
  job=json.loads(sql('SELECT row_to_json(x) FROM claim_recipient_delivery() x;'))
  jid,claim=job['id'],job['claim_token'];dg='a'*64
  sql(f"SELECT * FROM reserve_recipient_send('{jid}','{claim}','{dg}');")
  ok(f"NOT EXISTS(SELECT 1 FROM reserve_recipient_send('{jid}','{claim}','{'b'*64}'))",'same claim cannot authorize second submission')
  ok(f"recipient_access('{dg}')='{job['recipient_id']}'::uuid",'token binds exactly one recipient')
  ok("recipient_access('"+'c'*64+"') IS NULL",'invalid token denied')
  sql(f"UPDATE recipient_deliveries SET lease_expires_at=now()-interval '1 second' WHERE id='{jid}';SELECT * FROM claim_recipient_delivery();")
  ok(f"(SELECT status='uncertain' FROM recipient_deliveries WHERE id='{jid}')",'expired send lease uncertain, never retried')
  for _ in range(4):sql('SELECT * FROM claim_recipient_delivery();')
  ok(f"(SELECT status='uncertain' FROM recipient_deliveries WHERE id='{jid}')",'uncertain delivery remains quarantined')
  sql(f"UPDATE recipient_deliveries SET token_expires_at=now()-interval '1 second' WHERE id='{jid}';")
  ok(f"recipient_access('{dg}') IS NULL",'expired token denied')
  sql(f"UPDATE recipient_deliveries SET token_expires_at=now()+interval '1 day' WHERE id='{jid}';UPDATE message_releases SET revoked_at=now() WHERE id=(SELECT release_id FROM message_release_recipients WHERE id='{job['recipient_id']}');")
  ok(f"recipient_access('{dg}') IS NULL",'revoked release denies even unexpired capability')
  # Recover pre-send claims only.
  sql("UPDATE recipient_deliveries SET lease_expires_at=now()-interval '1 second' WHERE status='claimed'; SELECT * FROM claim_recipient_delivery();")
  ok("NOT EXISTS(SELECT 1 FROM recipient_deliveries WHERE status='claimed' AND lease_expires_at<now())",'pre-send claims recover safely')
  # Scoped acceleration: owner consent alone does not change normal timing.
  authid=sql(f"SET request.jwt.claim.sub='{future[0]}';SELECT authorize_release_acceleration('{future[2]}','Owner approved controlled delivery','AUTHORIZE EARLY IRREVERSIBLE RELEASE');")
  process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{future[2]}')",'consent alone cannot accelerate')
  sql(f"SELECT arm_release_acceleration('{authid}');")
  process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{future[2]}')",'armed acceleration still waits a minute')
  # Advance synthetic clock evidence only inside this disposable cluster.
  sql(f"UPDATE release_acceleration_authorizations SET armed_at=armed_at-interval '2 minutes',effective_deadline_at=effective_deadline_at-interval '2 minutes',expires_at=expires_at-interval '2 minutes' WHERE id='{authid}';")
  sql(f"UPDATE message_release_checks SET next_attempt_at=now()-interval '1 second' WHERE escalation_id='{future[2]}';")
  process();ok(f"EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{future[2]}')",'authorized acceleration releases after effective deadline')
  ok(f"(SELECT safety_deadline_at=majority_reached_at+interval '48 hours' FROM guardian_verification_rounds WHERE escalation_id='{future[2]}')",'original 48-hour evidence unchanged')
  invalid_parent=fixture();sql(f"UPDATE check_ins SET enabled=NULL WHERE id='{invalid_parent[1]}';");process()
  ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{invalid_parent[2]}')",'nullable or malformed parent fails closed')
  # Independent owners with the same email get separate collections.
  same=fixture(email='friend@example.invalid');process()
  ok(f"(SELECT count(*)=1 FROM message_release_recipients rr JOIN message_releases r ON r.id=rr.release_id WHERE r.user_id='{same[0]}')",'same email across owners stays separate')
  foreign=fixture();sql(f"UPDATE messages SET voice_path='{group[0]}/other-owner' WHERE id='{foreign[3][0]}'; INSERT INTO storage.objects(bucket_id,name) VALUES('message-audio','{group[0]}/other-owner');")
  process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{foreign[2]}')",'foreign owner attachment rejected')
  oversized=fixture();path=oversized[0]+'/oversized';sql(f"INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('message-audio','{path}','{{\"size\":104857601}}');UPDATE messages SET voice_path='{path}' WHERE id='{oversized[3][0]}';")
  process();ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{oversized[2]}')",'oversized file blocks before notification')
  # Two independent SQL sessions, cancellation holds parent before cron sees it.
  racing=fixture()
  holder=subprocess.Popen([str(BIN/'psql'),'-X','-qAt','-h',str(base),'-p','55449','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
  holder.stdin.write(f"BEGIN; SET request.jwt.claim.sub='{racing[0]}';SELECT confirm_check_in();SELECT 'READY';SELECT pg_sleep(1);COMMIT;\n");holder.stdin.close()
  while holder.stdout.readline().strip()!='READY':
   if holder.poll() is not None:raise RuntimeError(holder.stderr.read())
  process();assert holder.wait(timeout=10)==0;process()
  ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{racing[2]}')",'cancellation winning parent lock prevents concurrent release')
  # An explicitly scoped execution works with global automatic release disabled.
  scoped=fixture(False);unrelated=fixture()
  aid=sql(f"SET request.jwt.claim.sub='{scoped[0]}';SELECT authorize_release_acceleration('{scoped[2]}','Approved scoped operational release','AUTHORIZE EARLY IRREVERSIBLE RELEASE');")
  denied(f"SET ROLE authenticated;SELECT arm_release_acceleration('{aid}');",'owner cannot self-arm operator authorization')
  sql(f"SELECT arm_release_acceleration('{aid}');UPDATE release_acceleration_authorizations SET armed_at=armed_at-interval '2 minutes',effective_deadline_at=effective_deadline_at-interval '2 minutes',expires_at=expires_at-interval '2 minutes' WHERE id='{aid}';UPDATE private_delivery_settings SET release_enabled=false;")
  sql(f"SET ROLE service_role;SELECT * FROM process_private_message_releases('{aid}');")
  ok(f"EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{scoped[2]}')",'scoped authorization executes while global release remains off')
  ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{unrelated[2]}')",'scoped run cannot release unrelated due owner')
  revoked=fixture(False)
  aid=sql(f"SET request.jwt.claim.sub='{revoked[0]}';SELECT authorize_release_acceleration('{revoked[2]}','Approved then revoked by owner','AUTHORIZE EARLY IRREVERSIBLE RELEASE');")
  sql(f"SELECT arm_release_acceleration('{aid}');SET request.jwt.claim.sub='{revoked[0]}';SELECT revoke_release_acceleration('{aid}');UPDATE release_acceleration_authorizations SET armed_at=armed_at-interval '2 minutes',effective_deadline_at=effective_deadline_at-interval '2 minutes',expires_at=expires_at-interval '2 minutes' WHERE id='{aid}';SELECT * FROM process_private_message_releases('{aid}');")
  ok(f"NOT EXISTS(SELECT 1 FROM message_releases WHERE escalation_id='{revoked[2]}')",'revoked acceleration cannot release')
  # Claim concurrency reserves different notification rows.
  sql("UPDATE recipient_deliveries SET status='pending',claim_token=NULL,lease_expires_at=NULL WHERE status='claimed';")
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   jobs=list(pool.map(lambda _:sql('SELECT id FROM claim_recipient_delivery();'),range(2)))
  assert all(jobs) and jobs[0]!=jobs[1];print('PASS concurrent workers claim distinct notifications',flush=True)
  pending=json.loads(sql('SELECT row_to_json(d) FROM recipient_deliveries d WHERE id=\''+jobs[0]+'\';'))
  sql(f"SELECT * FROM reserve_recipient_send('{pending['id']}','{pending['claim_token']}','{'d'*64}');")
  ok(f"finish_recipient_send('{pending['id']}','{pending['claim_token']}','accepted','synthetic-provider-id')",'provider identifier finalized once')
  ok(f"NOT finish_recipient_send('{pending['id']}','{pending['claim_token']}','accepted','other-id')",'duplicate finalization cannot alter accepted delivery')
  ok(f"(SELECT provider_message_id='synthetic-provider-id' FROM recipient_deliveries WHERE id='{pending['id']}')",'original provider evidence preserved')
  print('ALL PRIVATE DELIVERY POSTGRES TESTS PASSED',flush=True)
 finally:
  if started:run('pg_ctl','-D',base/'data','-m','immediate','-w','stop')

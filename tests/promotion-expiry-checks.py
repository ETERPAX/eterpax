"""Additional checks in the existing disposable promotion PostgreSQL fixture."""
import concurrent.futures
import json

def run(sql, redeem, uid, digest, root):
    # Minimal legacy schema contracts. The original campaign fixture already
    # installs the actual paid/Guardian activation and billing functions.
    sql('''
ALTER TABLE auth.users ADD COLUMN email text;
UPDATE auth.users SET email='fixture@example.invalid';
CREATE SCHEMA storage;
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
CREATE POLICY fixture_owned_files ON storage.objects TO authenticated USING(true) WITH CHECK(true);
CREATE TABLE public.messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,body text,deletion_state text DEFAULT 'active',updated_at timestamptz DEFAULT now());
CREATE TABLE public.message_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,message_id uuid REFERENCES messages(id) ON DELETE CASCADE,storage_path text);
CREATE TABLE public.message_videos(LIKE public.message_photos INCLUDING ALL);
CREATE TABLE public.message_documents(LIKE public.message_photos INCLUDING ALL);
CREATE TABLE public.message_upload_operations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,message_id uuid);
CREATE TABLE public.message_deletion_requests(message_id uuid,user_id uuid,finalizing boolean DEFAULT false,finalized_at timestamptz);
CREATE TABLE public.continuity_timing_policy(response_window interval);
INSERT INTO public.continuity_timing_policy VALUES(interval '24 hours');
-- Executable fixture for the deployed engine contract, with the same eligibility
-- predicate, row locks and phase distinction. Installation must reject drift.
CREATE FUNCTION public.process_continuity_engine() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.check_ins%rowtype; n integer:=0; w interval;
BEGIN
 SELECT response_window INTO w FROM public.continuity_timing_policy;
 FOR r IN SELECT c.* FROM public.check_ins c where c.enabled = true
 AND ((c.status='scheduled' AND c.next_check_in_at<=clock_timestamp()) OR (c.status='awaiting_response' AND c.response_deadline_at<=clock_timestamp()))
 FOR UPDATE SKIP LOCKED LOOP
 IF r.status='scheduled' THEN
  UPDATE public.check_ins SET status='awaiting_response',response_deadline_at=clock_timestamp()+w,next_check_in_at=NULL WHERE id=r.id;
 ELSE
  UPDATE public.check_ins SET status=CASE WHEN missed_count=2 THEN 'escalation_pending' ELSE 'scheduled' END,
    missed_count=missed_count+1,next_check_in_at=CASE WHEN missed_count=2 THEN NULL ELSE clock_timestamp()+interval '1 day' END,response_deadline_at=NULL WHERE id=r.id;
 END IF;
 n:=n+1;
 END LOOP;
 RETURN n;
END $$;
''')
    sql("""
ALTER TABLE public.check_ins ADD COLUMN escalation_generation integer NOT NULL DEFAULT 1;
ALTER TABLE public.check_ins ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TABLE public.guardian_escalations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),check_in_id uuid,user_id uuid,status text,generation integer,closed_at timestamptz,owner_checked_in_at timestamptz);
""")
    sql((root/'supabase/migrations/202610080001_guardian_escalation_owner_check_in.sql').read_text())
    original_engine = sql("SELECT pg_get_functiondef('process_continuity_engine()'::regprocedure);")
    sql((root/'supabase/migrations/202611020001_promotion_expiry_policy.sql').read_text())
    patched_engine = sql("SELECT pg_get_functiondef('process_continuity_engine()'::regprocedure);")
    assert patched_engine.replace('\n      and public.promotion_cycle_allowed(c.user_id,c.status,c.missed_count)', '') == original_engine
    assert sql('SELECT enabled FROM promotion_campaign') == 'f'
    assert sql('SELECT enabled FROM promotion_notice_settings') == 'f'
    sql("UPDATE promotion_campaign SET enabled=true;")
    # Expired account 6 was redeemed and expired by the preceding test.
    expired=uid(6)
    assert sql(f"SELECT promotion_writes_allowed('{expired}')") == 'f'
    sql(f"INSERT INTO messages(id,user_id,body) VALUES('{uid(100)}','{uid(1)}','untouched');")
    # Move fixture ownership before testing expiry; direct administrative setup
    # outside app paths. Triggers still execute on service-role writes.
    sql('ALTER TABLE messages DISABLE TRIGGER promotion_message_writes;')
    sql(f"UPDATE messages SET user_id='{expired}' WHERE id='{uid(100)}';")
    sql('ALTER TABLE messages ENABLE TRIGGER promotion_message_writes;')
    def denied(query):
        try:
            sql(query)
            raise AssertionError('Expected denied operation')
        except RuntimeError as e:
            assert 'PROMOTION_EXPIRED_READ_ONLY' in str(e) or 'row-level security' in str(e), str(e)
    denied(f"INSERT INTO messages(user_id,body) VALUES('{expired}','forbidden');")
    denied(f"UPDATE messages SET body='forbidden' WHERE id='{uid(100)}';")
    denied(f"INSERT INTO message_photos(user_id,message_id,storage_path) VALUES('{expired}','{uid(100)}','forbidden');")
    denied(f"INSERT INTO message_upload_operations(user_id,message_id) VALUES('{expired}','{uid(100)}');")
    denied(f"SET ROLE authenticated; SET request.jwt.claim.sub='{expired}'; INSERT INTO storage.objects(bucket_id,name) VALUES('message-audio','forbidden');")
    denied(f"UPDATE check_ins SET frequency_days=7 WHERE user_id='{expired}';")
    assert sql(f"SELECT body FROM messages WHERE id='{uid(100)}'") == 'untouched'
    # Deletion bookkeeping alone may pass, but cannot carry a content edit.
    sql(f"INSERT INTO message_deletion_requests(message_id,user_id) VALUES('{uid(100)}','{expired}');")
    denied(f"UPDATE messages SET body='smuggled',deletion_state='deleting' WHERE id='{uid(100)}';")
    sql(f"UPDATE messages SET deletion_state='deleting' WHERE id='{uid(100)}';")
    sql(f"UPDATE message_deletion_requests SET finalizing=true WHERE message_id='{uid(100)}'; DELETE FROM messages WHERE id='{uid(100)}';")
    assert sql(f"SELECT count(*) FROM messages WHERE id='{uid(100)}'") == '0'
    # A scheduled request with no prior failures is not yet a started cycle.
    sql(f"UPDATE check_ins SET enabled=true,status='scheduled',missed_count=0,next_check_in_at=now()-interval '1 day',response_deadline_at=NULL WHERE user_id='{uid(1)}';")
    sql(f"UPDATE promotional_access SET starts_at=now()-interval '13 months',redeemed_at=now()-interval '13 months',expires_at=(now()-interval '13 months')+interval '12 months' WHERE user_id='{uid(1)}';")
    scheduled=sql(f"SELECT to_jsonb(c) FROM check_ins c WHERE user_id='{uid(1)}'")
    sql('SELECT process_continuity_engine();')
    assert sql(f"SELECT to_jsonb(c) FROM check_ins c WHERE user_id='{uid(1)}'") == scheduled
    # In-progress response still advances; reattempts (missed_count > 0) still run.
    sql(f"UPDATE check_ins SET status='awaiting_response',missed_count=0,response_deadline_at=now()-interval '1 hour' WHERE user_id='{uid(1)}'; SELECT process_continuity_engine();")
    assert sql(f"SELECT status||':'||missed_count FROM check_ins WHERE user_id='{uid(1)}'") == 'scheduled:1'
    sql(f"UPDATE check_ins SET next_check_in_at=now()-interval '1 second' WHERE user_id='{uid(1)}'; SELECT process_continuity_engine();")
    assert sql(f"SELECT status||':'||missed_count FROM check_ins WHERE user_id='{uid(1)}'") == 'awaiting_response:1'
    # Verification/Safety Window are not canceled or rewritten by expiry or
    # engine filtering. The existing confirmation RPC remains usable by owner.
    sql(f"INSERT INTO guardian_escalations(check_in_id,user_id,status,generation) SELECT id,user_id,'safety_window',escalation_generation FROM check_ins WHERE user_id='{uid(1)}';")
    safety=sql(f"SELECT to_jsonb(e) FROM guardian_escalations e WHERE user_id='{uid(1)}'")
    sql('SELECT process_continuity_engine();')
    assert sql(f"SELECT to_jsonb(e) FROM guardian_escalations e WHERE user_id='{uid(1)}'")==safety
    sql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{uid(1)}'; SELECT confirm_check_in();")
    assert sql(f"SELECT status FROM guardian_escalations WHERE user_id='{uid(1)}'")=='cancelled_owner_check_in'
    confirmed=sql(f"SELECT to_jsonb(c) FROM check_ins c WHERE user_id='{uid(1)}'")
    sql('SELECT process_continuity_engine();')
    assert sql(f"SELECT to_jsonb(c) FROM check_ins c WHERE user_id='{uid(1)}'")==confirmed
    # Purchase restores access immediately, without touching the current cycle.
    before=sql(f"SELECT to_jsonb(c) FROM check_ins c WHERE user_id='{uid(1)}'")
    payment=json.dumps(dict(user_id=uid(1),status='active',stripe_subscription_id='sub_restore_fixture',current_period_start='2026-01-01T00:00:00Z',current_period_end='2030-01-01T00:00:00Z'))
    sql(f"SELECT sync_guardian_plan_subscription('{payment}',now());")
    assert sql(f"SELECT to_jsonb(c) FROM check_ins c WHERE user_id='{uid(1)}'") == before
    assert sql(f"SELECT promotion_writes_allowed('{uid(1)}')") == 't'
    sql(f"INSERT INTO messages(user_id,body) VALUES('{uid(1)}','restored');")
    # New settings after expiry are blocked; confirmations are not filtered out.
    denied(f"INSERT INTO check_ins(user_id) VALUES('{uid(11)}');")  # existing row may hit before-trigger first
    # Durable 30/7-day reminders; schedule synthetic access within the due window.
    assert redeem(20, 20) == 'success'
    sql(f"UPDATE promotional_access SET starts_at=(now()+interval '29 days')-interval '12 months',redeemed_at=(now()+interval '29 days')-interval '12 months',expires_at=now()+interval '29 days' WHERE user_id='{uid(20)}';")
    assert sql('SELECT count(*) FROM claim_promotion_expiry_notice()') == '0'
    sql('UPDATE promotion_notice_settings SET enabled=true;')
    def claim(): return sql("SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM claim_promotion_expiry_notice() c;")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        rows=[json.loads(r) for r in pool.map(lambda _:claim(),range(2))]
    flat=[r for group in rows for r in group]
    # Other recent fixtures expire in ~12 months; only owner20 should be due.
    assert len(flat)==1 and flat[0]['days_before']==30, flat
    n=flat[0]
    assert sql(f"SELECT finish_promotion_expiry_notice('{n['user_id']}',30,'{n['claim_token']}','accepted','provider_fixture');")=='t'
    assert claim()=='[]'
    sql(f"UPDATE promotional_access SET starts_at=(now()+interval '6 days')-interval '12 months',redeemed_at=(now()+interval '6 days')-interval '12 months',expires_at=now()+interval '6 days' WHERE user_id='{uid(20)}';")
    n=json.loads(claim())[0];assert n['days_before']==7
    # Crash/timeout never makes the item eligible for a second send.
    sql("UPDATE promotion_expiry_notices SET claimed_at=now()-interval '6 minutes' WHERE status='sending';")
    assert claim()=='[]'
    assert sql("SELECT status FROM promotion_expiry_notices WHERE days_before=7")=='uncertain'
    assert sql("SELECT count(*) FROM promotion_expiry_notices")=='2'
    assert redeem(21,19)=='success'
    sql(f"UPDATE promotional_access SET starts_at=(now()+interval '29 days')-interval '12 months',redeemed_at=(now()+interval '29 days')-interval '12 months',expires_at=now()+interval '29 days' WHERE user_id='{uid(21)}'; INSERT INTO subscriptions(user_id,status,stripe_subscription_id) VALUES('{uid(21)}','active','sub_notice_suppressed_fixture');")
    assert claim()=='[]'  # another valid plan suppresses an unclaimed reminder
    readiness=json.loads(sql('SELECT social_promotion_readiness();'))
    assert readiness['policy_version']=='read_only_finish_started_cycles_v1' and readiness['engine_gated']
    assert sum(row['total'] for row in readiness['inventory'])==20

    assert sql("SELECT has_function_privilege('authenticated','claim_promotion_expiry_notice()','EXECUTE')")=='f'
    assert sql("SELECT has_table_privilege('authenticated','promotion_expiry_notices','SELECT,INSERT,UPDATE,DELETE')")=='f'
    print('PASS: expiry blocks messages/attachments/storage/configuration/new cycles; active cycles continue; purchase restores without resetting; deletion retained; 30/7-day reminders concurrent/idempotent with no uncertain resend.')

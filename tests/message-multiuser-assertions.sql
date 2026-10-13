DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM message_file_settings WHERE coordination_enabled OR delete_enabled OR recovery_enabled) THEN RAISE EXCEPTION 'activated during installation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM message_deletion_requests WHERE finalized_at IS NOT NULL) THEN RAISE EXCEPTION 'old audit lost'; END IF;
 IF has_function_privilege('authenticated','public.request_message_deletion(uuid,uuid)','EXECUTE') OR has_function_privilege('anon','public.claim_message_file_cleanup_scoped(integer,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'public RPC'; END IF;
END $$;
UPDATE message_file_settings SET coordination_enabled=true,delete_enabled=true,recovery_enabled=true,private_delivery_reviewed_disabled=true;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_messages_owner ON messages FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000002'; SET ROLE authenticated;
DO $$ BEGIN
 IF NOT message_coordination_enabled(auth.uid()) THEN RAISE EXCEPTION 'new owner not admitted'; END IF;
 IF EXISTS(SELECT 1 FROM messages WHERE user_id<>auth.uid()) THEN RAISE EXCEPTION 'RLS leak'; END IF;
 BEGIN PERFORM request_message_deletion(auth.uid(),'00000000-0000-4000-8000-000000000202'); RAISE EXCEPTION 'RPC exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('message-audio','00000000-0000-4000-8000-000000000002/unregistered-new'); RAISE EXCEPTION 'legacy write fence bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN PERFORM request_message_deletion('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000202'); RAISE EXCEPTION 'owner mismatch accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='owner mismatch accepted' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM message_file_rollout WHERE user_id IN ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003')) THEN RAISE EXCEPTION 'test requires no per-user enrollment'; END IF;
END $$;
SELECT request_message_deletion('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000201');
SELECT request_message_deletion('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000202');
-- Keep unrelated legacy fixtures out of the test batch, without changing production.
UPDATE message_file_cleanup SET next_attempt_at=now()+interval '1 day' WHERE message_id NOT IN ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000202');
CREATE TEMP TABLE multi_claim AS SELECT * FROM claim_message_file_cleanup_scoped(10);
DO $$ BEGIN
 IF (SELECT count(*) FROM multi_claim)<>1 OR NOT EXISTS(SELECT 1 FROM multi_claim WHERE user_id='00000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'global claim/shared retention failed'; END IF;
 IF EXISTS(SELECT 1 FROM claim_message_file_cleanup_scoped(10)) THEN RAISE EXCEPTION 'duplicate lease'; END IF;
 IF finalize_message_deletion('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000202')<>'pending' THEN RAISE EXCEPTION 'premature finalization'; END IF;
END $$;
-- Simulate ambiguous Storage removal: metadata remains, then reconcile absence.
DO $$ DECLARE c record; BEGIN
 SELECT * INTO c FROM multi_claim;
 IF verify_message_file_cleanup(c.message_id,c.bucket,c.path,c.claim_token,'before')<>'ready' THEN RAISE EXCEPTION 'not ready'; END IF;
 IF verify_message_file_cleanup(c.message_id,c.bucket,c.path,c.claim_token,'after')<>'present' THEN RAISE EXCEPTION 'false absence'; END IF;
 DELETE FROM storage.objects WHERE bucket_id=c.bucket AND name=c.path;
 IF verify_message_file_cleanup(c.message_id,c.bucket,c.path,c.claim_token,'after')<>'absent' THEN RAISE EXCEPTION 'absence lost'; END IF;
END $$;
UPDATE message_deletion_requests SET next_attempt_at=now()+interval '1 day' WHERE message_id NOT IN ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000202');
CREATE TEMP TABLE finished AS SELECT * FROM finalize_message_deletion_batch(10);
DO $$ BEGIN
 IF (SELECT count(*) FROM finished WHERE outcome='deleted')<>2 THEN RAISE EXCEPTION 'automatic finalization failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE name='00000000-0000-4000-8000-000000000002/legacy.webm') OR NOT EXISTS(SELECT 1 FROM messages WHERE id='00000000-0000-4000-8000-000000000203') THEN RAISE EXCEPTION 'shared file/message deleted'; END IF;
 IF finalize_message_deletion('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000202')<>'blocked' THEN RAISE EXCEPTION 'completed owner leak'; END IF;
 IF EXISTS(SELECT 1 FROM finalize_message_deletion_batch(10)) THEN RAISE EXCEPTION 'repeat finalization'; END IF;
END $$;
-- A late Storage arrival remains discoverable after metadata finalization.
INSERT INTO storage.objects(bucket_id,name) VALUES('message-audio','00000000-0000-4000-8000-000000000003/legacy.webm');
UPDATE message_file_cleanup SET next_attempt_at=now()-interval '1 second' WHERE message_id='00000000-0000-4000-8000-000000000202';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM claim_message_file_cleanup_scoped(2,'00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000202')) THEN RAISE EXCEPTION 'late arrival lost'; END IF;
END $$;
-- Even cancelled parent escalations cannot conceal unresolved verification emissions.
INSERT INTO guardian_escalations(id,user_id,status,closed_at) VALUES('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000003','cancelled_owner_check_in',now());
INSERT INTO guardian_verification_notifications(id,escalation_id,status) VALUES('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000301','uncertain');
DO $$ BEGIN
 IF message_deletion_safe('00000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'verification bypass'; END IF;
 IF NOT message_deletion_safe('00000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'other owner blocked'; END IF;
END $$;
UPDATE guardian_verification_notifications SET status='accepted';
INSERT INTO guardian_verification_emission_attempts(notification_id,status) VALUES('00000000-0000-4000-8000-000000000302','uncertain');
DO $$ BEGIN
 IF message_deletion_safe('00000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'emission bypass'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE '%message_deletion%' OR p.proname LIKE '%message_file_cleanup%') AND p.prosrc LIKE '%50cc8dbe%') THEN RAISE EXCEPTION 'hardcoded owner remains'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.message_file_rollout'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%50cc8dbe%') THEN RAISE EXCEPTION 'test-only rollout remains'; END IF;
END $$;

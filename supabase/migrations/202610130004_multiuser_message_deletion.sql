BEGIN;
SET LOCAL lock_timeout = '5s';
-- Incremental upgrade only. Existing inventories, leases and requests survive.
ALTER TABLE public.message_file_rollout DROP CONSTRAINT message_file_rollout_user_id_check;
CREATE TABLE public.message_file_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 coordination_enabled boolean NOT NULL DEFAULT false,
 delete_enabled boolean NOT NULL DEFAULT false,
 recovery_enabled boolean NOT NULL DEFAULT false,
 private_delivery_reviewed_disabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.message_file_settings(singleton) VALUES(true);
ALTER TABLE public.message_file_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_file_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.message_file_settings TO service_role;
CREATE TRIGGER message_settings_guard BEFORE UPDATE OR DELETE ON public.message_file_settings
 FOR EACH ROW EXECUTE FUNCTION public.guard_message_rollout();
-- Once enabled, coordination cannot be removed beneath an in-flight upload.
-- Legacy enrollment rows remain as compatibility data; new accounts need none.
CREATE OR REPLACE FUNCTION public.message_coordination_enabled(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_user_id IS NOT NULL AND (
 EXISTS(SELECT 1 FROM public.message_file_settings WHERE singleton AND coordination_enabled)
 OR EXISTS(SELECT 1 FROM public.message_file_rollout WHERE user_id=p_user_id AND coordination_enabled));
$$;
CREATE OR REPLACE FUNCTION public.message_deletion_safe(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_user_id IS NOT NULL AND public.message_coordination_enabled(p_user_id)
 AND EXISTS(SELECT 1 FROM public.message_file_settings WHERE singleton AND private_delivery_reviewed_disabled)
 AND NOT EXISTS(SELECT 1 FROM public.check_ins WHERE user_id=p_user_id AND (status IS DISTINCT FROM 'scheduled' OR missed_count IS DISTINCT FROM 0))
 AND NOT EXISTS(SELECT 1 FROM public.guardian_escalations WHERE user_id=p_user_id AND (status IS DISTINCT FROM 'cancelled_owner_check_in' OR closed_at IS NULL))
 AND NOT EXISTS(SELECT 1 FROM public.guardian_verification_notifications n JOIN public.guardian_escalations e ON e.id=n.escalation_id WHERE e.user_id=p_user_id AND n.status NOT IN ('accepted','failed','cancelled'))
 AND NOT EXISTS(SELECT 1 FROM public.guardian_verification_emission_attempts a JOIN public.guardian_verification_notifications n ON n.id=a.notification_id JOIN public.guardian_escalations e ON e.id=n.escalation_id WHERE e.user_id=p_user_id AND a.status IN ('reserved','uncertain'));
$$;
ALTER TABLE public.message_deletion_requests ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX message_deletion_recovery_due ON public.message_deletion_requests(next_attempt_at,message_id) WHERE finalized_at IS NULL;
CREATE INDEX message_file_cleanup_due ON public.message_file_cleanup(next_attempt_at,message_id);
CREATE INDEX message_upload_recovery_due ON public.message_upload_operations(expires_at,id) WHERE state IN ('pending','uploaded');
CREATE FUNCTION public.request_message_deletion(p_user_id uuid,p_message_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.messages%rowtype;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.message_file_settings WHERE singleton AND delete_enabled) THEN RAISE EXCEPTION 'Deletion disabled'; END IF;
 PERFORM 1 FROM public.check_ins WHERE user_id=p_user_id ORDER BY id FOR UPDATE;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,810));
 IF NOT public.message_deletion_safe(p_user_id) THEN RAISE EXCEPTION 'Unresolved continuity or delivery state'; END IF;
 SELECT * INTO m FROM public.messages WHERE id=p_message_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.message_deletion_requests WHERE message_id=p_message_id AND user_id=p_user_id AND finalized_at IS NOT NULL) THEN RETURN 'deleted'; END IF;
  RAISE EXCEPTION 'Message unavailable';
 END IF;
 IF m.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Only verified drafts are eligible'; END IF;
 INSERT INTO public.message_deletion_requests(message_id,user_id) VALUES(m.id,m.user_id) ON CONFLICT DO NOTHING;
 UPDATE public.messages SET deletion_state='deleting' WHERE id=m.id AND deletion_state='active';
 INSERT INTO public.message_file_cleanup(message_id,user_id,bucket,path)
 SELECT m.id,m.user_id,bucket,path FROM public.message_file_references WHERE message_id=m.id
 UNION SELECT m.id,m.user_id,bucket,path FROM public.message_upload_operations WHERE message_id=m.id
 ON CONFLICT DO NOTHING;
 UPDATE public.message_upload_operations SET state='failed' WHERE message_id=m.id AND state<>'attached';
 RETURN 'pending';
END $$;

CREATE FUNCTION public.finalize_message_deletion(p_user_id uuid,p_message_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.messages%rowtype;
BEGIN
 IF EXISTS(SELECT 1 FROM public.message_deletion_requests WHERE message_id=p_message_id AND user_id=p_user_id AND finalized_at IS NOT NULL) THEN RETURN 'deleted'; END IF;
 PERFORM 1 FROM public.check_ins WHERE user_id=p_user_id ORDER BY id FOR UPDATE;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,810));
 IF NOT public.message_deletion_safe(p_user_id) THEN RETURN 'blocked'; END IF;
 SELECT * INTO m FROM public.messages WHERE id=p_message_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public.message_deletion_requests WHERE message_id=p_message_id AND user_id=p_user_id AND finalized_at IS NOT NULL) THEN RETURN 'deleted'; END IF;
  RETURN 'blocked';
 END IF;
 IF m.status IS DISTINCT FROM 'draft' OR m.deletion_state<>'deleting' THEN RETURN 'blocked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.message_deletion_requests WHERE message_id=m.id AND user_id=p_user_id) THEN RETURN 'blocked'; END IF;
 -- Inventory must cover every current and registered path before removing metadata.
 IF EXISTS(SELECT bucket,path FROM public.message_file_references WHERE message_id=m.id
 UNION SELECT bucket,path FROM public.message_upload_operations WHERE message_id=m.id
 EXCEPT SELECT bucket,path FROM public.message_file_cleanup WHERE message_id=m.id) THEN RETURN 'pending'; END IF;
 IF EXISTS(SELECT 1 FROM public.message_file_cleanup c WHERE c.message_id=m.id AND (
 c.claim_token IS NOT NULL OR
 NOT ((c.outcome='removed' AND NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=c.bucket AND o.name=c.path))
 OR (c.outcome='retained_shared' AND EXISTS(SELECT 1 FROM public.message_file_references f WHERE f.bucket=c.bucket AND f.path=c.path AND f.message_id<>m.id)))
 OR c.outcome IS NULL)) THEN RETURN 'pending'; END IF;
 UPDATE public.message_deletion_requests SET finalizing=true WHERE message_id=m.id;
 DELETE FROM public.message_upload_operations WHERE message_id=m.id;
 DELETE FROM public.messages WHERE id=m.id AND user_id=p_user_id;
 UPDATE public.message_deletion_requests SET finalizing=false,finalized_at=clock_timestamp() WHERE message_id=m.id;
 -- Inventory survives FK cascades and continues reconciling late Storage arrivals.
 RETURN 'deleted';
END $$;
CREATE FUNCTION public.claim_message_file_cleanup_scoped(p_limit integer DEFAULT 2,p_user_id uuid DEFAULT NULL,p_message_id uuid DEFAULT NULL)
RETURNS SETOF public.message_file_cleanup LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; c public.message_file_cleanup%rowtype;
BEGIN
 IF p_message_id IS NOT NULL AND p_user_id IS NULL THEN RAISE EXCEPTION 'Owner required for message scope'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.message_file_settings WHERE singleton AND recovery_enabled) THEN RETURN; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>10 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
 -- Bounded recovery of interrupted uploads, including a lost completion response.
 FOR r IN SELECT * FROM public.message_upload_operations WHERE (p_user_id IS NULL OR user_id=p_user_id) AND (p_message_id IS NULL OR message_id=p_message_id) AND state IN ('pending','uploaded') AND expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.user_id::text,810));
  UPDATE public.message_upload_operations SET state='failed' WHERE id=r.id AND state IN ('pending','uploaded') AND expires_at<=clock_timestamp();
  IF FOUND THEN INSERT INTO public.message_file_cleanup(message_id,user_id,bucket,path) VALUES(r.message_id,r.user_id,r.bucket,r.path) ON CONFLICT DO NOTHING; END IF;
 END LOOP;
 FOR c IN SELECT * FROM public.message_file_cleanup AS jobs WHERE (p_user_id IS NULL OR user_id=p_user_id) AND (p_message_id IS NULL OR message_id=p_message_id) AND (outcome IS DISTINCT FROM 'removed' OR EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=jobs.bucket AND o.name=jobs.path)) AND next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) ORDER BY next_attempt_at,message_id,bucket,path LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.bucket||'/'||c.path,811));
  IF EXISTS(SELECT 1 FROM public.message_file_cleanup x WHERE x.bucket=c.bucket AND x.path=c.path AND x.message_id<>c.message_id AND x.claim_token IS NOT NULL AND x.lease_expires_at>clock_timestamp()) THEN CONTINUE; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.user_id::text,810));
  IF NOT public.message_deletion_safe(c.user_id) THEN
   UPDATE public.message_file_cleanup SET next_attempt_at=clock_timestamp()+interval '5 minutes' WHERE message_id=c.message_id AND bucket=c.bucket AND path=c.path;
   CONTINUE;
  END IF;
  IF EXISTS(SELECT 1 FROM public.message_file_references f JOIN public.messages m ON m.id=f.message_id WHERE f.bucket=c.bucket AND f.path=c.path AND (f.message_id<>c.message_id OR m.deletion_state='active')) THEN
   UPDATE public.message_file_cleanup SET outcome='retained_shared',next_attempt_at=clock_timestamp()+interval '1 hour',claim_token=NULL,lease_expires_at=NULL WHERE message_id=c.message_id AND bucket=c.bucket AND path=c.path;
  ELSE
   UPDATE public.message_file_cleanup SET claim_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1 WHERE message_id=c.message_id AND bucket=c.bucket AND path=c.path RETURNING * INTO c;
   RETURN NEXT c;
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.verify_message_file_cleanup(
 p_message_id uuid,p_bucket text,p_path text,p_token uuid,p_phase text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.message_file_cleanup%rowtype;
BEGIN
 IF p_phase IS NULL OR p_phase NOT IN ('before','after') THEN RAISE EXCEPTION 'Invalid phase'; END IF;
 -- Serialize verification of this physical object, even across different jobs.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_bucket||'/'||p_path,811));
 SELECT * INTO c FROM public.message_file_cleanup WHERE message_id=p_message_id AND bucket=p_bucket AND path=p_path FOR UPDATE;
 IF NOT FOUND OR c.claim_token IS DISTINCT FROM p_token OR p_token IS NULL
 OR c.lease_expires_at IS NULL OR c.lease_expires_at<=clock_timestamp() THEN RETURN 'lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.message_file_settings WHERE singleton AND recovery_enabled) OR NOT public.message_deletion_safe(c.user_id) THEN RETURN 'blocked'; END IF;
 IF p_phase='before' AND c.lease_expires_at<clock_timestamp()+interval '30 seconds' THEN RETURN 'lost'; END IF;
 IF EXISTS(SELECT 1 FROM public.message_file_cleanup x WHERE x.bucket=p_bucket AND x.path=p_path AND x.message_id<>p_message_id
 AND x.claim_token IS NOT NULL AND x.lease_expires_at>clock_timestamp()) THEN RETURN 'blocked'; END IF;
 -- Reference checks deliberately ignore caller RLS and include other owners.
 IF EXISTS(SELECT 1 FROM public.message_file_references f JOIN public.messages m ON m.id=f.message_id
 WHERE f.bucket=p_bucket AND f.path=p_path AND (f.message_id<>p_message_id OR m.deletion_state='active'))
 OR EXISTS(SELECT 1 FROM public.message_upload_operations u WHERE u.bucket=p_bucket AND u.path=p_path AND u.state IN ('pending','uploaded')) THEN
  UPDATE public.message_file_cleanup SET outcome='retained_shared',next_attempt_at=clock_timestamp()+interval '5 minutes',claim_token=NULL,lease_expires_at=NULL
  WHERE message_id=p_message_id AND bucket=p_bucket AND path=p_path;
  RETURN 'blocked';
 END IF;
 IF p_phase='before' THEN RETURN 'ready'; END IF;
 -- Storage acknowledgement alone is not sufficient. Keep tombstones even after
 -- verified absence; a late transfer is revisited by the existing recurring claim.
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=p_bucket AND name=p_path) THEN RETURN 'present'; END IF;
 UPDATE public.message_file_cleanup SET outcome='removed',next_attempt_at=clock_timestamp()+interval '5 minutes',claim_token=NULL,lease_expires_at=NULL
 WHERE message_id=p_message_id AND bucket=p_bucket AND path=p_path;
 RETURN 'absent';
END $$;

-- Compatibility entry points delegate to the same multiuser implementation.
CREATE OR REPLACE FUNCTION public.claim_message_file_cleanup(p_limit integer DEFAULT 10)
RETURNS SETOF public.message_file_cleanup LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT * FROM public.claim_message_file_cleanup_scoped(p_limit,NULL,NULL);
$$;
CREATE OR REPLACE FUNCTION public.request_test_message_deletion(p_user_id uuid,p_message_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT public.request_message_deletion(p_user_id,p_message_id); $$;
CREATE OR REPLACE FUNCTION public.finalize_test_message_deletion(p_user_id uuid,p_message_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT public.finalize_message_deletion(p_user_id,p_message_id); $$;
CREATE OR REPLACE FUNCTION public.claim_test_message_file_cleanup(p_limit integer DEFAULT 2,p_message_id uuid DEFAULT NULL)
RETURNS SETOF public.message_file_cleanup LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid;
BEGIN
 IF p_message_id IS NOT NULL THEN
  SELECT user_id INTO v_owner FROM public.message_deletion_requests WHERE message_id=p_message_id;
  IF v_owner IS NULL THEN RETURN; END IF;
 END IF;
 RETURN QUERY SELECT * FROM public.claim_message_file_cleanup_scoped(p_limit,v_owner,p_message_id);
END $$;
CREATE OR REPLACE FUNCTION public.verify_test_message_file_cleanup(p_message_id uuid,p_bucket text,p_path text,p_token uuid,p_phase text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.verify_message_file_cleanup(p_message_id,p_bucket,p_path,p_token,p_phase);
$$;
-- Server-only, bounded finalization; no Storage calls or browser required.
CREATE FUNCTION public.finalize_message_deletion_batch(p_limit integer DEFAULT 10)
RETURNS TABLE(message_id uuid,outcome text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; v_outcome text;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>10 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.message_file_settings WHERE singleton AND recovery_enabled) THEN RETURN; END IF;
 FOR r IN SELECT d.message_id,d.user_id FROM public.message_deletion_requests d WHERE d.finalized_at IS NULL AND d.next_attempt_at<=clock_timestamp() ORDER BY d.next_attempt_at,d.message_id LIMIT p_limit FOR UPDATE OF d SKIP LOCKED LOOP
  BEGIN
   v_outcome:=public.finalize_message_deletion(r.user_id,r.message_id);
  EXCEPTION WHEN deadlock_detected OR lock_not_available THEN v_outcome:='pending';
  END;
  UPDATE public.message_deletion_requests d SET next_attempt_at=clock_timestamp()+CASE WHEN v_outcome='blocked' THEN interval '5 minutes' ELSE interval '30 seconds' END WHERE d.message_id=r.message_id;
  message_id:=r.message_id; outcome:=v_outcome; RETURN NEXT;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.request_message_deletion(uuid,uuid),public.finalize_message_deletion(uuid,uuid),public.claim_message_file_cleanup_scoped(integer,uuid,uuid),public.finalize_message_deletion_batch(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_message_deletion(uuid,uuid),public.finalize_message_deletion(uuid,uuid),public.claim_message_file_cleanup_scoped(integer,uuid,uuid),public.finalize_message_deletion_batch(integer) TO service_role;
-- Existing function ACLs survive CREATE OR REPLACE. No cron is installed here.
COMMIT;

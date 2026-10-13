BEGIN;
-- No private delivery reservation was found under the confirmed catalog criteria.
-- This is NOT proof of absence everywhere: only reviewed draft messages may proceed.
CREATE FUNCTION public.message_deletion_safe(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_user_id='50cc8dbe-be5a-460b-9e00-429acdcf9563'::uuid
 AND EXISTS(SELECT 1 FROM public.message_file_rollout WHERE user_id=p_user_id AND coordination_enabled AND private_delivery_reviewed_disabled)
 AND NOT EXISTS(SELECT 1 FROM public.check_ins WHERE user_id=p_user_id AND (status IS DISTINCT FROM 'scheduled' OR missed_count IS DISTINCT FROM 0))
 AND NOT EXISTS(SELECT 1 FROM public.guardian_escalations WHERE user_id=p_user_id AND (status IS DISTINCT FROM 'cancelled_owner_check_in' OR closed_at IS NULL));
$$;
REVOKE ALL ON FUNCTION public.message_deletion_safe(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.message_deletion_safe(uuid) TO service_role;

CREATE FUNCTION public.request_test_message_deletion(p_user_id uuid,p_message_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.messages%rowtype;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.message_file_rollout WHERE user_id=p_user_id AND delete_enabled) THEN RAISE EXCEPTION 'Deletion disabled'; END IF;
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

CREATE FUNCTION public.finalize_test_message_deletion(p_user_id uuid,p_message_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.messages%rowtype;
BEGIN
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
REVOKE ALL ON FUNCTION public.request_test_message_deletion(uuid,uuid),public.finalize_test_message_deletion(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_test_message_deletion(uuid,uuid),public.finalize_test_message_deletion(uuid,uuid) TO service_role;
-- Retire the phase-2 entry point: all deletion requests must pass the new safety gate.
REVOKE ALL ON FUNCTION public.begin_message_deletion(uuid) FROM service_role;
CREATE FUNCTION public.claim_test_message_file_cleanup(p_limit integer DEFAULT 2,p_message_id uuid DEFAULT NULL)
RETURNS SETOF public.message_file_cleanup LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; c public.message_file_cleanup%rowtype;
BEGIN
 IF NOT public.message_deletion_safe('50cc8dbe-be5a-460b-9e00-429acdcf9563') THEN RETURN; END IF;
 IF p_limit IS NULL OR p_limit<1 OR p_limit>2 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
 -- Bounded recovery of interrupted uploads, including a lost completion response.
 FOR r IN SELECT * FROM public.message_upload_operations WHERE user_id='50cc8dbe-be5a-460b-9e00-429acdcf9563' AND (p_message_id IS NULL OR message_id=p_message_id) AND state IN ('pending','uploaded') AND expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT p_limit LOOP
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.user_id::text,810));
  UPDATE public.message_upload_operations SET state='failed' WHERE id=r.id AND state IN ('pending','uploaded');
  IF FOUND THEN INSERT INTO public.message_file_cleanup(message_id,user_id,bucket,path) VALUES(r.message_id,r.user_id,r.bucket,r.path) ON CONFLICT DO NOTHING; END IF;
 END LOOP;
 FOR c IN SELECT * FROM public.message_file_cleanup WHERE user_id='50cc8dbe-be5a-460b-9e00-429acdcf9563' AND (p_message_id IS NULL OR message_id=p_message_id) AND next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) ORDER BY next_attempt_at,message_id,bucket,path LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.bucket||'/'||c.path,811));
  IF EXISTS(SELECT 1 FROM public.message_file_cleanup x WHERE x.bucket=c.bucket AND x.path=c.path AND x.message_id<>c.message_id AND x.claim_token IS NOT NULL AND x.lease_expires_at>clock_timestamp()) THEN CONTINUE; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.user_id::text,810));
  IF EXISTS(SELECT 1 FROM public.message_file_references f JOIN public.messages m ON m.id=f.message_id WHERE f.bucket=c.bucket AND f.path=c.path AND (f.message_id<>c.message_id OR m.deletion_state='active')) THEN
   UPDATE public.message_file_cleanup SET outcome='retained_shared',next_attempt_at=clock_timestamp()+interval '1 hour',claim_token=NULL,lease_expires_at=NULL WHERE message_id=c.message_id AND bucket=c.bucket AND path=c.path;
  ELSE
   UPDATE public.message_file_cleanup SET claim_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1 WHERE message_id=c.message_id AND bucket=c.bucket AND path=c.path RETURNING * INTO c;
   RETURN NEXT c;
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION public.verify_test_message_file_cleanup(p_message_id uuid,p_bucket text,p_path text,p_token uuid,p_phase text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.message_deletion_safe('50cc8dbe-be5a-460b-9e00-429acdcf9563') THEN RETURN 'blocked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.message_file_cleanup WHERE message_id=p_message_id AND bucket=p_bucket AND path=p_path AND user_id='50cc8dbe-be5a-460b-9e00-429acdcf9563') THEN RETURN 'lost'; END IF;
 RETURN public.verify_message_file_cleanup(p_message_id,p_bucket,p_path,p_token,p_phase);
END $$;
REVOKE ALL ON FUNCTION public.claim_test_message_file_cleanup(integer,uuid),public.verify_test_message_file_cleanup(uuid,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_test_message_file_cleanup(integer,uuid),public.verify_test_message_file_cleanup(uuid,text,text,uuid,text) TO service_role;
GRANT SELECT ON public.message_deletion_requests TO service_role;
COMMIT;


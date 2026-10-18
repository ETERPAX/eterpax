BEGIN;

-- Extend the existing claim: one live lease per physical bucket/path.
CREATE OR REPLACE FUNCTION public.claim_message_file_cleanup(p_limit integer DEFAULT 10)
RETURNS SETOF public.message_file_cleanup LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; c public.message_file_cleanup%rowtype;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>10 THEN RAISE EXCEPTION 'Invalid limit'; END IF;
 -- Bounded recovery of interrupted uploads, including a lost completion response.
 FOR r IN SELECT * FROM public.message_upload_operations WHERE state IN ('pending','uploaded') AND expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT p_limit LOOP
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.user_id::text,810));
  UPDATE public.message_upload_operations SET state='failed' WHERE id=r.id AND state IN ('pending','uploaded');
  IF FOUND THEN INSERT INTO public.message_file_cleanup(message_id,user_id,bucket,path) VALUES(r.message_id,r.user_id,r.bucket,r.path) ON CONFLICT DO NOTHING; END IF;
 END LOOP;
 FOR c IN SELECT * FROM public.message_file_cleanup WHERE next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) ORDER BY next_attempt_at,message_id,bucket,path LIMIT p_limit FOR UPDATE SKIP LOCKED LOOP
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
-- Reuse existing inventory/leases. No new queue and no record deletion.
CREATE FUNCTION public.verify_message_file_cleanup(
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
REVOKE ALL ON FUNCTION public.verify_message_file_cleanup(uuid,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_message_file_cleanup(uuid,text,text,uuid,text) TO service_role;
COMMIT;

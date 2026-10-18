BEGIN;

ALTER TABLE public.messages ADD COLUMN deletion_state text NOT NULL DEFAULT 'active'
  CHECK (deletion_state IN ('active', 'deleting'));

-- Initial rollout is inert; only the authorized owner can be enrolled.
CREATE TABLE public.message_file_rollout (
 user_id uuid PRIMARY KEY CHECK(user_id='50cc8dbe-be5a-460b-9e00-429acdcf9563'::uuid),
 coordination_enabled boolean NOT NULL DEFAULT false,
 delete_enabled boolean NOT NULL DEFAULT false,
 private_delivery_reviewed_disabled boolean NOT NULL DEFAULT false
);
ALTER TABLE public.message_file_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_file_rollout FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.message_file_rollout TO service_role;
INSERT INTO public.message_file_rollout(user_id) VALUES('50cc8dbe-be5a-460b-9e00-429acdcf9563');
CREATE FUNCTION public.message_coordination_enabled(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.message_file_rollout WHERE user_id=p_user_id AND coordination_enabled);
$$;
REVOKE ALL ON FUNCTION public.message_coordination_enabled(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.message_coordination_enabled(uuid) TO authenticated,service_role;

CREATE FUNCTION public.guard_message_rollout() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR (OLD.coordination_enabled AND NOT NEW.coordination_enabled) THEN
  RAISE EXCEPTION 'Keep coordination enabled; disable deletion and recovery to pause safely';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_message_rollout() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER message_rollout_guard BEFORE UPDATE OR DELETE ON public.message_file_rollout
 FOR EACH ROW EXECUTE FUNCTION public.guard_message_rollout();

CREATE TABLE public.message_deletion_requests (
 message_id uuid PRIMARY KEY, user_id uuid NOT NULL, finalizing boolean NOT NULL DEFAULT false, finalized_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_deletion_requests FROM PUBLIC,anon,authenticated;

CREATE TABLE public.message_upload_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('message-audio','message-videos','message-photos','message-documents')),
  path text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','uploaded','attached','failed')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bucket,path)
);
-- Durable tombstones: deliberately no cascading FK. Never discard a path merely
-- because Storage returned success; an already-running transfer may arrive later.
CREATE TABLE public.message_file_cleanup (
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  bucket text NOT NULL,
  path text NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  outcome text CHECK (outcome IN ('removed','retained_shared','retry')),
  PRIMARY KEY(message_id,bucket,path)
);
ALTER TABLE public.message_upload_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_file_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_upload_operations, public.message_file_cleanup FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.message_upload_operations, public.message_file_cleanup TO service_role;

-- Include legacy paths as well as all child-table references. No encryption data.
CREATE VIEW public.message_file_references AS
 SELECT id AS message_id,user_id,'message-audio'::text AS bucket,voice_path AS path FROM public.messages WHERE voice_path IS NOT NULL AND voice_path<>''
 UNION SELECT id,user_id,'message-videos',video_path FROM public.messages WHERE video_path IS NOT NULL AND video_path<>''
 UNION SELECT id,user_id,'message-documents',document_path FROM public.messages WHERE document_path IS NOT NULL AND document_path<>''
 UNION SELECT message_id,user_id,'message-videos',video_path FROM public.message_videos WHERE video_path IS NOT NULL AND video_path<>''
 UNION SELECT message_id,user_id,'message-documents',document_path FROM public.message_documents WHERE document_path IS NOT NULL AND document_path<>''
 UNION SELECT message_id,user_id,'message-photos',storage_path FROM public.message_photos WHERE storage_path IS NOT NULL AND storage_path<>'';
REVOKE ALL ON public.message_file_references FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.register_message_upload(p_message_id uuid,p_bucket text,p_operation_id uuid)
RETURNS public.message_upload_operations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid := auth.uid(); v_message public.messages%rowtype; v_op public.message_upload_operations%rowtype;
BEGIN
 IF NOT public.message_coordination_enabled(v_owner) THEN RAISE EXCEPTION 'Coordination disabled'; END IF;
 IF v_owner IS NULL OR p_operation_id IS NULL OR p_bucket NOT IN ('message-audio','message-videos','message-photos','message-documents') OR p_bucket IS NULL THEN RAISE EXCEPTION 'Invalid upload'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text,810));
 SELECT * INTO v_message FROM public.messages WHERE id=p_message_id AND user_id=v_owner FOR UPDATE;
 IF NOT FOUND OR v_message.deletion_state<>'active' THEN RAISE EXCEPTION 'Message unavailable'; END IF;
 SELECT * INTO v_op FROM public.message_upload_operations WHERE id=p_operation_id;
 IF FOUND THEN
  IF v_op.user_id<>v_owner OR v_op.message_id<>p_message_id OR v_op.bucket<>p_bucket OR v_op.state='failed' THEN RAISE EXCEPTION 'Operation unavailable'; END IF;
  RETURN v_op;
 END IF;
 INSERT INTO public.message_upload_operations(id,message_id,user_id,bucket,path)
 VALUES(p_operation_id,p_message_id,v_owner,p_bucket,v_owner::text||'/'||p_message_id::text||'/'||p_operation_id::text)
 RETURNING * INTO v_op;
 RETURN v_op;
END $$;

CREATE FUNCTION public.complete_message_upload(p_operation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=auth.uid(); v_op public.message_upload_operations%rowtype;
BEGIN
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text,810));
 SELECT * INTO v_op FROM public.message_upload_operations WHERE id=p_operation_id AND user_id=v_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Operation unavailable'; END IF;
 IF v_op.state IN ('uploaded','attached') THEN RETURN v_op.state; END IF;
 IF v_op.state<>'pending' OR v_op.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.messages WHERE id=v_op.message_id AND deletion_state='active') THEN RAISE EXCEPTION 'Upload closed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=v_op.bucket AND name=v_op.path) THEN RAISE EXCEPTION 'Upload not visible'; END IF;
 UPDATE public.message_upload_operations SET state='uploaded' WHERE id=v_op.id;
 RETURN 'uploaded';
END $$;

-- RESTRICTIVE policies AND with the existing permissive owner policies.
-- Serialize object authorization with deletion/cleanup and never allow upserts.
CREATE FUNCTION public.message_upload_allowed(p_bucket text,p_path text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=auth.uid();
BEGIN
 IF v_owner IS NULL THEN RETURN false; END IF;
 IF NOT public.message_coordination_enabled(v_owner) THEN RETURN NOT EXISTS(SELECT 1 FROM public.message_file_cleanup WHERE bucket=p_bucket AND path=p_path); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text,810));
 RETURN EXISTS(SELECT 1 FROM public.message_upload_operations u JOIN public.messages m ON m.id=u.message_id
 WHERE u.user_id=v_owner AND m.user_id=v_owner AND m.deletion_state='active'
 AND u.bucket=p_bucket AND u.path=p_path AND u.state='pending' AND u.expires_at>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM public.message_file_cleanup c WHERE c.bucket=p_bucket AND c.path=p_path));
END $$;
CREATE POLICY message_upload_registration ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (bucket_id NOT IN ('message-audio','message-videos','message-photos','message-documents') OR public.message_upload_allowed(bucket_id,name));
CREATE POLICY message_files_immutable ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (bucket_id NOT IN ('message-audio','message-videos','message-photos','message-documents') OR (NOT public.message_coordination_enabled(auth.uid()) AND public.message_upload_allowed(bucket_id,name)))
 WITH CHECK (bucket_id NOT IN ('message-audio','message-videos','message-photos','message-documents') OR (NOT public.message_coordination_enabled(auth.uid()) AND public.message_upload_allowed(bucket_id,name)));
-- All removals now go through the durable cleanup service, including editor removals.
CREATE POLICY message_files_managed_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING (bucket_id NOT IN ('message-audio','message-videos','message-photos','message-documents') OR (NOT public.message_coordination_enabled(auth.uid()) AND public.message_upload_allowed(bucket_id,name)));

CREATE FUNCTION public.guard_message_file_writes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_new jsonb; v_old jsonb; v_owner uuid; v_message uuid; v_bucket text; v_path text; v_key text; v_op uuid;
BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='messages' AND to_jsonb(OLD)->>'deletion_state'='deleting' AND NOT EXISTS(SELECT 1 FROM public.message_deletion_requests WHERE message_id=OLD.id AND finalizing) THEN RAISE EXCEPTION 'Final deletion is not enabled'; END IF;
  v_new:=to_jsonb(OLD);
 ELSE v_new:=to_jsonb(NEW); END IF;
 v_old:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
 v_owner:=(v_new->>'user_id')::uuid;
 v_message:=CASE WHEN TG_TABLE_NAME='messages' THEN (v_new->>'id')::uuid ELSE (v_new->>'message_id')::uuid END;
 -- Finalizer alone owns this marker; allow parent/cascade deletes only then.
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.message_deletion_requests WHERE message_id=v_message AND user_id=v_owner AND finalizing) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (v_new->>'user_id' IS DISTINCT FROM v_old->>'user_id' OR v_new->>'id' IS DISTINCT FROM v_old->>'id' OR v_new->>'message_id' IS DISTINCT FROM v_old->>'message_id') THEN RAISE EXCEPTION 'Immutable identity'; END IF;
 -- Serialize new references against cleanup claims, including legacy clients.
 -- After a tombstone commits, no owner may attach its path to another message.
 IF TG_OP<>'DELETE' THEN
  FOR v_bucket,v_key IN SELECT * FROM (VALUES ('message-audio','voice_path'),('message-videos','video_path'),('message-documents','document_path'),('message-photos','storage_path')) AS fields(bucket,key) LOOP
   v_path:=v_new->>v_key;
   IF v_path IS NOT NULL AND v_path<>'' AND v_path IS DISTINCT FROM v_old->>v_key THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_bucket||'/'||v_path,811));
    IF EXISTS(SELECT 1 FROM public.message_file_cleanup WHERE bucket=v_bucket AND path=v_path) THEN RAISE EXCEPTION 'File retiring'; END IF;
   END IF;
  END LOOP;
 END IF;
 -- Non-enrolled owners retain their legacy flow, except reusing retiring paths.
 IF NOT public.message_coordination_enabled(v_owner) THEN
  IF TG_OP<>'DELETE' THEN
   FOR v_bucket,v_key IN SELECT * FROM (VALUES ('message-audio','voice_path'),('message-videos','video_path'),('message-documents','document_path'),('message-photos','storage_path')) AS fields(bucket,key) LOOP
    IF v_new->>v_key IS DISTINCT FROM v_old->>v_key AND EXISTS(SELECT 1 FROM public.message_file_cleanup WHERE bucket=v_bucket AND path=v_new->>v_key) THEN RAISE EXCEPTION 'File retiring'; END IF;
   END LOOP;
   IF TG_TABLE_NAME='messages' AND v_new->>'deletion_state' IS DISTINCT FROM COALESCE(v_old->>'deletion_state','active') THEN RAISE EXCEPTION 'Deletion disabled'; END IF;
   RETURN NEW;
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='DELETE' AND TG_TABLE_NAME='messages' THEN RAISE EXCEPTION 'Use coordinated deletion'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text,810));
 IF TG_OP='UPDATE' AND (v_new->>'user_id' IS DISTINCT FROM v_old->>'user_id' OR v_new->>'id' IS DISTINCT FROM v_old->>'id'
 OR v_new->>'message_id' IS DISTINCT FROM v_old->>'message_id') THEN RAISE EXCEPTION 'Immutable identity'; END IF;
 IF TG_TABLE_NAME='messages' THEN
  IF TG_OP='INSERT' AND NEW.deletion_state<>'active' THEN RAISE EXCEPTION 'Invalid initial state'; END IF;
  IF TG_OP='UPDATE' AND (OLD.deletion_state<>'active' OR NEW.deletion_state IS DISTINCT FROM OLD.deletion_state) THEN
   -- Only a durable request created by begin_message_deletion permits this transition.
   IF NOT EXISTS(SELECT 1 FROM public.message_deletion_requests WHERE message_id=v_message AND user_id=v_owner)
     OR OLD.deletion_state<>'active' OR NEW.deletion_state<>'deleting' THEN RAISE EXCEPTION 'Message deleting'; END IF;
  END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.messages WHERE id=v_message AND user_id=v_owner AND deletion_state='active') THEN RAISE EXCEPTION 'Message unavailable'; END IF;
 END IF;
 FOR v_bucket,v_key IN SELECT * FROM (VALUES
  ('message-audio','voice_path'),('message-videos','video_path'),('message-documents','document_path'),('message-photos','storage_path')) AS fields(bucket,key)
 LOOP
  v_path:=v_new->>v_key;
  IF TG_OP<>'INSERT' AND v_old->>v_key IS NOT NULL AND v_old->>v_key<>'' AND (TG_OP='DELETE' OR v_path IS DISTINCT FROM v_old->>v_key) THEN
   INSERT INTO public.message_file_cleanup(message_id,user_id,bucket,path) VALUES(v_message,v_owner,v_bucket,v_old->>v_key) ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP='DELETE' OR v_path IS NULL OR v_path='' OR v_path IS NOT DISTINCT FROM v_old->>v_key THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM public.message_file_cleanup WHERE bucket=v_bucket AND path=v_path) THEN RAISE EXCEPTION 'File retiring'; END IF;
  SELECT id INTO v_op FROM public.message_upload_operations WHERE message_id=v_message AND user_id=v_owner AND bucket=v_bucket AND path=v_path AND state IN ('uploaded','attached');
  IF NOT FOUND THEN RAISE EXCEPTION 'Unregistered file association'; END IF;
  UPDATE public.message_upload_operations SET state='attached' WHERE id=v_op;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE FUNCTION public.begin_message_deletion(p_message_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=auth.uid();
BEGIN
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text,810));
 PERFORM 1 FROM public.messages WHERE id=p_message_id AND user_id=v_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Message unavailable'; END IF;
 INSERT INTO public.message_deletion_requests(message_id,user_id) VALUES(p_message_id,v_owner) ON CONFLICT DO NOTHING;
 UPDATE public.messages SET deletion_state='deleting' WHERE id=p_message_id AND deletion_state='active';
 INSERT INTO public.message_file_cleanup(message_id,user_id,bucket,path)
 SELECT p_message_id,v_owner,bucket,path FROM public.message_file_references WHERE message_id=p_message_id
 UNION SELECT p_message_id,v_owner,bucket,path FROM public.message_upload_operations WHERE message_id=p_message_id
 ON CONFLICT DO NOTHING;
 UPDATE public.message_upload_operations SET state='failed' WHERE message_id=p_message_id AND state<>'attached';
END $$;

CREATE TRIGGER message_file_guard BEFORE INSERT OR UPDATE OR DELETE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.guard_message_file_writes();
CREATE TRIGGER message_photo_guard BEFORE INSERT OR UPDATE OR DELETE ON public.message_photos FOR EACH ROW EXECUTE FUNCTION public.guard_message_file_writes();
CREATE TRIGGER message_video_guard BEFORE INSERT OR UPDATE OR DELETE ON public.message_videos FOR EACH ROW EXECUTE FUNCTION public.guard_message_file_writes();
CREATE TRIGGER message_document_guard BEFORE INSERT OR UPDATE OR DELETE ON public.message_documents FOR EACH ROW EXECUTE FUNCTION public.guard_message_file_writes();

CREATE FUNCTION public.claim_message_file_cleanup(p_limit integer DEFAULT 10)
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
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c.user_id::text,810));
  IF EXISTS(SELECT 1 FROM public.message_file_references f JOIN public.messages m ON m.id=f.message_id WHERE f.bucket=c.bucket AND f.path=c.path AND (f.message_id<>c.message_id OR m.deletion_state='active')) THEN
   UPDATE public.message_file_cleanup SET outcome='retained_shared',next_attempt_at=clock_timestamp()+interval '1 hour',claim_token=NULL,lease_expires_at=NULL WHERE message_id=c.message_id AND bucket=c.bucket AND path=c.path;
  ELSE
   UPDATE public.message_file_cleanup SET claim_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1 WHERE message_id=c.message_id AND bucket=c.bucket AND path=c.path RETURNING * INTO c;
   RETURN NEXT c;
  END IF;
 END LOOP;
END $$;
CREATE FUNCTION public.finish_message_file_cleanup(p_message_id uuid,p_bucket text,p_path text,p_token uuid,p_removed boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.message_file_cleanup SET outcome=CASE WHEN p_removed THEN 'removed' ELSE 'retry' END,
 next_attempt_at=clock_timestamp()+interval '5 minutes',claim_token=NULL,lease_expires_at=NULL
 WHERE message_id=p_message_id AND bucket=p_bucket AND path=p_path AND claim_token=p_token;
 RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.register_message_upload(uuid,text,uuid),public.complete_message_upload(uuid),public.message_upload_allowed(text,text),public.begin_message_deletion(uuid),public.guard_message_file_writes(),public.claim_message_file_cleanup(integer),public.finish_message_file_cleanup(uuid,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_message_upload(uuid,text,uuid),public.complete_message_upload(uuid),public.message_upload_allowed(text,text) TO authenticated;
CREATE FUNCTION public.queue_message_file_removal(p_message_id uuid,p_bucket text,p_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid:=auth.uid();
BEGIN
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text,810));
 IF NOT EXISTS(SELECT 1 FROM public.messages WHERE id=p_message_id AND user_id=v_owner AND deletion_state='active') THEN RAISE EXCEPTION 'Message unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.message_upload_operations WHERE message_id=p_message_id AND user_id=v_owner AND bucket=p_bucket AND path=p_path)
 AND NOT EXISTS(SELECT 1 FROM public.message_file_references WHERE message_id=p_message_id AND user_id=v_owner AND bucket=p_bucket AND path=p_path)
 AND NOT EXISTS(SELECT 1 FROM public.message_file_cleanup WHERE message_id=p_message_id AND user_id=v_owner AND bucket=p_bucket AND path=p_path) THEN RAISE EXCEPTION 'File unavailable'; END IF;
 INSERT INTO public.message_file_cleanup(message_id,user_id,bucket,path) VALUES(p_message_id,v_owner,p_bucket,p_path) ON CONFLICT DO NOTHING;
 UPDATE public.message_upload_operations SET state='failed' WHERE message_id=p_message_id AND bucket=p_bucket AND path=p_path AND state IN ('pending','uploaded');
END $$;
REVOKE ALL ON FUNCTION public.queue_message_file_removal(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_message_file_removal(uuid,text,text) TO authenticated;

CREATE FUNCTION public.message_file_readable(p_bucket text,p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.message_file_references f JOIN public.messages m ON m.id=f.message_id
 WHERE f.bucket=p_bucket AND f.path=p_path AND m.user_id=auth.uid() AND m.deletion_state='active')
 OR EXISTS(SELECT 1 FROM public.message_upload_operations u JOIN public.messages m ON m.id=u.message_id
 WHERE u.bucket=p_bucket AND u.path=p_path AND u.user_id=auth.uid() AND m.deletion_state='active' AND u.state<>'failed');
$$;
REVOKE ALL ON FUNCTION public.message_file_readable(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.message_file_readable(text,text) TO authenticated;
CREATE POLICY message_files_active_reads ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING(bucket_id NOT IN ('message-audio','message-videos','message-photos','message-documents') OR NOT public.message_coordination_enabled(auth.uid()) OR public.message_file_readable(bucket_id,name));

CREATE POLICY message_active_reads ON public.messages AS RESTRICTIVE FOR SELECT TO authenticated
 USING (deletion_state='active');
CREATE POLICY message_photo_active_reads ON public.message_photos AS RESTRICTIVE FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.messages WHERE id=message_id AND deletion_state='active'));
CREATE POLICY message_video_active_reads ON public.message_videos AS RESTRICTIVE FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.messages WHERE id=message_id AND deletion_state='active'));
CREATE POLICY message_document_active_reads ON public.message_documents AS RESTRICTIVE FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.messages WHERE id=message_id AND deletion_state='active'));

-- begin_message_deletion deliberately NOT granted to authenticated in infrastructure phase.
GRANT EXECUTE ON FUNCTION public.begin_message_deletion(uuid),public.claim_message_file_cleanup(integer),public.finish_message_file_cleanup(uuid,text,text,uuid,boolean) TO service_role;
COMMIT;

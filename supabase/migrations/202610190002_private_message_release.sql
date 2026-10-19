-- Private delivery is installed DISABLED. Apply after 202610190001 and 202610130004.
-- No provider calls, backfill, activation or deadline changes.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.private_delivery_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 release_enabled boolean NOT NULL DEFAULT false,
 delivery_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.private_delivery_settings DEFAULT VALUES;
CREATE TABLE public.message_release_checks (
 escalation_id uuid PRIMARY KEY REFERENCES public.guardian_escalations(id),
 last_checked_at timestamptz NOT NULL, next_attempt_at timestamptz NOT NULL,
 outcome_code text NOT NULL DEFAULT 'evaluating', error_sqlstate text
);
CREATE TABLE public.message_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 escalation_id uuid NOT NULL UNIQUE REFERENCES public.guardian_escalations(id),
 user_id uuid NOT NULL, generation bigint NOT NULL,
 original_deadline_at timestamptz NOT NULL,
 authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 UNIQUE(id,user_id)
);
CREATE TABLE public.message_release_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 release_id uuid NOT NULL REFERENCES public.message_releases(id),
 email text NOT NULL CHECK(email=lower(btrim(email)) AND length(email)<=254 AND email ~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$'),
 UNIQUE(release_id,email), UNIQUE(id,release_id)
);
CREATE TABLE public.message_release_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 release_id uuid NOT NULL,
 recipient_id uuid NOT NULL,
 message_id uuid NOT NULL UNIQUE REFERENCES public.messages(id),
 snapshot jsonb NOT NULL,
 FOREIGN KEY(recipient_id,release_id) REFERENCES public.message_release_recipients(id,release_id)
);
CREATE TABLE public.message_release_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL REFERENCES public.message_release_items(id),
 kind text NOT NULL CHECK(kind IN ('voice','video','photo','document')),
 bucket text NOT NULL CHECK(bucket IN ('message-audio','message-videos','message-photos','message-documents')),
 path text NOT NULL, metadata jsonb NOT NULL,
 UNIQUE(item_id,bucket,path)
);
CREATE INDEX message_release_asset_path ON public.message_release_assets(bucket,path);
CREATE TABLE public.recipient_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipient_id uuid NOT NULL UNIQUE REFERENCES public.message_release_recipients(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','sending','accepted','failed','uncertain','cancelled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 claim_token uuid, lease_expires_at timestamptz,
 attempt_count integer NOT NULL DEFAULT 0,
 token_digest text UNIQUE CHECK(token_digest ~ '^[0-9a-f]{64}$'),
 token_expires_at timestamptz,
 send_started_at timestamptz, accepted_at timestamptz,
 provider_message_id text, outcome_code text,
 CHECK((token_digest IS NULL)=(token_expires_at IS NULL))
);
CREATE INDEX recipient_delivery_pending ON public.recipient_deliveries(available_at,id) WHERE status IN ('pending','claimed','sending');
-- Explicit owner consent + separate operator arm. Original timing evidence is immutable.
CREATE TABLE public.release_acceleration_authorizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 escalation_id uuid NOT NULL UNIQUE REFERENCES public.guardian_escalations(id),
 user_id uuid NOT NULL, generation bigint NOT NULL,
 original_deadline_at timestamptz NOT NULL,
 consent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
 armed_at timestamptz, effective_deadline_at timestamptz, expires_at timestamptz,
 revoked_at timestamptz, consumed_at timestamptz,
 CHECK(armed_at IS NULL OR (effective_deadline_at=armed_at+interval '1 minute' AND expires_at=armed_at+interval '15 minutes'))
);

ALTER TABLE public.guardian_escalations
 DROP CONSTRAINT guardian_escalations_status_check,
 DROP CONSTRAINT guardian_escalations_closed_at_check,
 DROP CONSTRAINT guardian_escalations_owner_check_in_check,
 ADD CONSTRAINT guardian_escalations_status_check CHECK(status IN ('waiting_for_responses','safety_window','stopped_negative','frozen_no_majority','cancelled_owner_check_in','blocked_invalid_guardian_set','blocked_verification_delivery','released')),
 ADD CONSTRAINT guardian_escalations_closed_at_check CHECK(
 (status IN ('waiting_for_responses','safety_window') AND closed_at IS NULL) OR
 (status IN ('stopped_negative','frozen_no_majority','cancelled_owner_check_in','blocked_invalid_guardian_set','blocked_verification_delivery','released') AND closed_at IS NOT NULL)),
 ADD CONSTRAINT guardian_escalations_owner_check_in_check CHECK(
 (status IN ('waiting_for_responses','safety_window','blocked_verification_delivery','released') AND owner_checked_in_at IS NULL) OR
 status IN ('stopped_negative','frozen_no_majority','blocked_invalid_guardian_set') OR
 (status='cancelled_owner_check_in' AND owner_checked_in_at IS NOT NULL));

-- Freeze original content after authorization; serialize all writers with snapshotting.
CREATE FUNCTION public.guard_released_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb; mid uuid; owner_id uuid;
BEGIN
 j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 mid:=CASE WHEN TG_TABLE_NAME='messages' THEN (j->>'id')::uuid ELSE (j->>'message_id')::uuid END;
 owner_id:=(j->>'user_id')::uuid;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,810));
 IF TG_OP='UPDATE' AND (to_jsonb(OLD)->>'user_id' IS DISTINCT FROM j->>'user_id' OR
  to_jsonb(OLD)->>'id' IS DISTINCT FROM j->>'id' OR to_jsonb(OLD)->>'message_id' IS DISTINCT FROM j->>'message_id') THEN
  RAISE EXCEPTION 'Immutable message identity';
 END IF;
 IF EXISTS(SELECT 1 FROM public.message_release_items WHERE message_id=mid) THEN RAISE EXCEPTION 'Message already released'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER a_release_guard BEFORE INSERT OR UPDATE OR DELETE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.guard_released_message();
CREATE TRIGGER a_release_guard BEFORE INSERT OR UPDATE OR DELETE ON public.message_photos FOR EACH ROW EXECUTE FUNCTION public.guard_released_message();
CREATE TRIGGER a_release_guard BEFORE INSERT OR UPDATE OR DELETE ON public.message_videos FOR EACH ROW EXECUTE FUNCTION public.guard_released_message();
CREATE TRIGGER a_release_guard BEFORE INSERT OR UPDATE OR DELETE ON public.message_documents FOR EACH ROW EXECUTE FUNCTION public.guard_released_message();
-- Also protect shared paths from cleanup and service-role Storage mutations.
CREATE FUNCTION public.guard_released_storage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.message_release_assets WHERE bucket=OLD.bucket_id AND path=OLD.name) THEN
  RAISE EXCEPTION 'Released file retained';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER private_release_storage_guard BEFORE UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.guard_released_storage();

CREATE FUNCTION public.release_encryption_valid(j jsonb,prefix text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ((j->>(prefix||'_encryption_version') IS NULL AND j->>(prefix||'_iv') IS NULL AND j->>(prefix||'_encrypted_key') IS NULL)
 OR (j->>(prefix||'_encryption_version')='v1' AND length(j->>(prefix||'_iv'))>0 AND length(j->>(prefix||'_encrypted_key'))>0)) IS TRUE
$$;

CREATE FUNCTION public.authorize_release_acceleration(p_escalation_id uuid,p_reason text,p_confirmation text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.guardian_escalations%rowtype; r public.guardian_verification_rounds%rowtype; aid uuid;
BEGIN
 IF auth.uid() IS NULL OR p_confirmation IS DISTINCT FROM 'AUTHORIZE EARLY IRREVERSIBLE RELEASE' THEN RAISE EXCEPTION 'Explicit owner authorization required'; END IF;
 PERFORM 1 FROM public.check_ins WHERE user_id=auth.uid() FOR UPDATE;
 SELECT * INTO e FROM public.guardian_escalations WHERE id=p_escalation_id AND user_id=auth.uid() FOR UPDATE;
 SELECT * INTO r FROM public.guardian_verification_rounds WHERE escalation_id=e.id;
 IF e.status IS DISTINCT FROM 'safety_window' OR e.closed_at IS NOT NULL OR e.owner_checked_in_at IS NOT NULL OR r.safety_deadline_at<=clock_timestamp() OR r.safety_deadline_at IS NULL THEN RAISE EXCEPTION 'Unavailable'; END IF;
 INSERT INTO public.release_acceleration_authorizations(escalation_id,user_id,generation,original_deadline_at,reason)
 VALUES(e.id,e.user_id,e.generation,r.safety_deadline_at,p_reason) RETURNING id INTO aid;
 RETURN aid;
END $$;
CREATE FUNCTION public.arm_release_acceleration(p_authorization_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n timestamptz:=clock_timestamp();
BEGIN
 UPDATE public.release_acceleration_authorizations SET armed_at=n,effective_deadline_at=n+interval '1 minute',expires_at=n+interval '15 minutes'
 WHERE id=p_authorization_id AND armed_at IS NULL AND revoked_at IS NULL AND consumed_at IS NULL AND consent_at>n-interval '1 hour';
 IF NOT FOUND THEN RAISE EXCEPTION 'Authorization unavailable'; END IF;
END $$;
CREATE FUNCTION public.revoke_release_acceleration(p_authorization_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Same parent lock as release: revocation winning this lock prevents acceleration.
 PERFORM 1 FROM public.check_ins c JOIN public.release_acceleration_authorizations a ON a.user_id=c.user_id
 WHERE a.id=p_authorization_id AND a.user_id=auth.uid() FOR UPDATE OF c;
 UPDATE public.release_acceleration_authorizations SET revoked_at=clock_timestamp()
 WHERE id=p_authorization_id AND user_id=auth.uid() AND consumed_at IS NULL AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Authorization unavailable or already consumed'; END IF;
END $$;

CREATE FUNCTION public.process_private_message_releases(p_authorization_id uuid DEFAULT NULL) RETURNS TABLE(escalation_id uuid,outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET "TimeZone"='UTC' AS $$
DECLARE candidate record; e public.guardian_escalations%rowtype; c public.check_ins%rowtype;
 r public.guardian_verification_rounds%rowtype; a public.release_acceleration_authorizations%rowtype;
 n timestamptz; total integer; positives integer; rid uuid; recipient uuid; item uuid;
 m record; asset record; j jsonb; cnt integer;
BEGIN
 IF p_authorization_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.private_delivery_settings WHERE singleton AND release_enabled) THEN RETURN; END IF;
 FOR candidate IN SELECT x.id,x.check_in_id FROM public.guardian_escalations x
 JOIN public.guardian_verification_rounds y ON y.escalation_id=x.id
 JOIN public.check_ins z ON z.id=x.check_in_id AND z.user_id=x.user_id
 LEFT JOIN public.message_release_checks scan ON scan.escalation_id=x.id
 WHERE (p_authorization_id IS NULL OR EXISTS(SELECT 1 FROM public.release_acceleration_authorizations scoped WHERE scoped.id=p_authorization_id AND scoped.escalation_id=x.id AND scoped.effective_deadline_at<=clock_timestamp() AND scoped.expires_at>clock_timestamp() AND scoped.revoked_at IS NULL AND scoped.consumed_at IS NULL))
 AND (scan.next_attempt_at IS NULL OR scan.next_attempt_at<=clock_timestamp()) AND x.status='safety_window' AND (y.safety_deadline_at<=clock_timestamp() OR EXISTS(
 SELECT 1 FROM public.release_acceleration_authorizations aa WHERE aa.escalation_id=x.id AND aa.effective_deadline_at<=clock_timestamp() AND aa.expires_at>clock_timestamp() AND aa.revoked_at IS NULL AND aa.consumed_at IS NULL))
 ORDER BY scan.last_checked_at NULLS FIRST,y.safety_deadline_at,x.id LIMIT 10 FOR UPDATE OF z SKIP LOCKED
 LOOP
  escalation_id:=candidate.id;
  INSERT INTO public.message_release_checks AS scan(escalation_id,last_checked_at,next_attempt_at)
   VALUES(candidate.id,clock_timestamp(),clock_timestamp()+interval '5 minutes')
   ON CONFLICT ON CONSTRAINT message_release_checks_pkey DO UPDATE SET last_checked_at=EXCLUDED.last_checked_at,next_attempt_at=EXCLUDED.next_attempt_at;
  BEGIN
   SELECT * INTO c FROM public.check_ins WHERE id=candidate.check_in_id FOR UPDATE;
   SELECT * INTO e FROM public.guardian_escalations WHERE id=candidate.id FOR UPDATE;
   SELECT * INTO r FROM public.guardian_verification_rounds WHERE guardian_verification_rounds.escalation_id=e.id FOR UPDATE;
   SELECT * INTO a FROM public.release_acceleration_authorizations aa WHERE aa.escalation_id=e.id FOR UPDATE;
   n:=clock_timestamp();
   IF e.status IS DISTINCT FROM 'safety_window' OR e.closed_at IS NOT NULL OR e.owner_checked_in_at IS NOT NULL
    OR c.user_id IS DISTINCT FROM e.user_id OR c.enabled IS DISTINCT FROM true OR c.status IS DISTINCT FROM 'escalation_pending' OR c.missed_count IS DISTINCT FROM 3
    OR c.next_check_in_at IS NOT NULL OR c.response_deadline_at IS NOT NULL
    OR c.escalation_generation IS DISTINCT FROM e.generation OR c.last_check_in_at>=r.majority_reached_at
    OR r.majority_reached_at IS NULL OR r.safety_deadline_at IS DISTINCT FROM r.majority_reached_at+interval '48 hours'
    OR r.dispatch_exhausted_at IS NOT NULL
    OR (r.safety_deadline_at<=n OR (a.user_id=e.user_id AND a.generation=e.generation AND a.original_deadline_at=r.safety_deadline_at
      AND a.effective_deadline_at<=n AND a.expires_at>n AND a.revoked_at IS NULL AND a.consumed_at IS NULL)) IS DISTINCT FROM true
   THEN outcome:='ineligible'; UPDATE public.message_release_checks SET outcome_code=outcome,error_sqlstate=NULL WHERE message_release_checks.escalation_id=candidate.id; RETURN NEXT; CONTINUE; END IF;
   SELECT count(*) INTO total FROM public.guardian_escalation_participants p WHERE p.escalation_id=e.id;
   SELECT count(*) INTO positives FROM public.guardian_verification_responses v
   JOIN public.guardian_escalation_participants p ON p.escalation_id=v.escalation_id AND p.source_guardian_id=v.source_guardian_id
   WHERE v.escalation_id=e.id AND v.decision='positive' AND v.responded_at<=r.majority_reached_at;
   IF total<1 OR positives<total/2+1 THEN outcome:='insufficient_majority'; UPDATE public.message_release_checks SET outcome_code=outcome,error_sqlstate=NULL WHERE message_release_checks.escalation_id=candidate.id; RETURN NEXT; CONTINUE; END IF;
   IF EXISTS(SELECT 1 FROM public.message_releases x WHERE x.escalation_id=e.id) THEN outcome:='already_released'; UPDATE public.message_release_checks SET outcome_code=outcome,error_sqlstate=NULL WHERE message_release_checks.escalation_id=candidate.id; RETURN NEXT; CONTINUE; END IF;
   PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(e.user_id::text,810));
   -- All active drafts are a single atomic release. Invalid/in-flight content blocks it,
   -- rather than silently losing part of the owner's intended delivery.
   IF EXISTS(SELECT 1 FROM public.message_upload_operations WHERE user_id=e.user_id AND state IN ('pending','uploaded')) THEN
    outcome:='uploads_pending'; UPDATE public.message_release_checks SET outcome_code=outcome,error_sqlstate=NULL WHERE message_release_checks.escalation_id=candidate.id; RETURN NEXT; CONTINUE;
   END IF;
   SELECT count(*) INTO cnt FROM public.messages mm WHERE mm.user_id=e.user_id AND mm.deletion_state='active' AND mm.status='draft'
    AND NOT EXISTS(SELECT 1 FROM public.message_release_items i WHERE i.message_id=mm.id);
   IF cnt=0 THEN outcome:='no_messages'; UPDATE public.message_release_checks SET outcome_code=outcome,error_sqlstate=NULL WHERE message_release_checks.escalation_id=candidate.id; RETURN NEXT; CONTINUE; END IF;
   IF cnt>1000 THEN outcome:='message_limit'; UPDATE public.message_release_checks SET outcome_code=outcome,error_sqlstate=NULL WHERE message_release_checks.escalation_id=candidate.id; RETURN NEXT; CONTINUE; END IF;
   INSERT INTO public.message_releases(escalation_id,user_id,generation,original_deadline_at,authorized_at)
    VALUES(e.id,e.user_id,e.generation,r.safety_deadline_at,n) RETURNING id INTO rid;
   FOR m IN SELECT mm.* FROM public.messages mm WHERE mm.user_id=e.user_id AND mm.deletion_state='active' AND mm.status='draft'
    AND NOT EXISTS(SELECT 1 FROM public.message_release_items i WHERE i.message_id=mm.id) ORDER BY mm.id
   LOOP
    j:=to_jsonb(m);
    IF NOT public.release_encryption_valid(j,'body') OR btrim(COALESCE(j->>'recipient_email','')) !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' THEN RAISE EXCEPTION 'Invalid message'; END IF;
    INSERT INTO public.message_release_recipients(release_id,email) VALUES(rid,lower(btrim(j->>'recipient_email')))
     ON CONFLICT(release_id,email) DO UPDATE SET email=EXCLUDED.email RETURNING id INTO recipient;
    INSERT INTO public.message_release_items(release_id,recipient_id,message_id,snapshot) VALUES(rid,recipient,m.id,j) RETURNING id INTO item;
    FOR asset IN
     SELECT 'voice' kind,'message-audio' bucket,j->>'voice_path' path,j metadata
     UNION ALL SELECT 'video','message-videos',j->>'video_path',j WHERE NOT EXISTS(SELECT 1 FROM public.message_videos v WHERE v.message_id=m.id AND v.user_id=e.user_id AND v.video_path=j->>'video_path')
     UNION ALL SELECT 'document','message-documents',j->>'document_path',j WHERE NOT EXISTS(SELECT 1 FROM public.message_documents d WHERE d.message_id=m.id AND d.user_id=e.user_id AND d.document_path=j->>'document_path')
     UNION ALL SELECT 'photo','message-photos',p.storage_path,to_jsonb(p) FROM public.message_photos p WHERE p.message_id=m.id AND p.user_id=e.user_id
     UNION ALL SELECT 'video','message-videos',v.video_path,to_jsonb(v) FROM public.message_videos v WHERE v.message_id=m.id AND v.user_id=e.user_id
     UNION ALL SELECT 'document','message-documents',d.document_path,to_jsonb(d) FROM public.message_documents d WHERE d.message_id=m.id AND d.user_id=e.user_id
    LOOP
     IF asset.path IS NULL OR asset.path='' THEN CONTINUE; END IF;
     IF split_part(asset.path,'/',1)<>e.user_id::text OR NOT public.release_encryption_valid(asset.metadata,asset.kind) THEN RAISE EXCEPTION 'Invalid attachment'; END IF;
     -- Lock each object against concurrent cleanup; files are never copied or made public.
     PERFORM 1 FROM storage.objects o WHERE o.bucket_id=asset.bucket AND o.name=asset.path AND (o.metadata->>'size')::bigint BETWEEN 1 AND 104857600 FOR UPDATE;
     IF NOT FOUND OR EXISTS(SELECT 1 FROM public.message_file_cleanup f WHERE f.bucket=asset.bucket AND f.path=asset.path AND (f.lease_expires_at>n OR f.outcome='removed')) THEN RAISE EXCEPTION 'Attachment unavailable'; END IF;
     INSERT INTO public.message_release_assets(item_id,kind,bucket,path,metadata) VALUES(item,asset.kind,asset.bucket,asset.path,asset.metadata) ON CONFLICT(item_id,bucket,path) DO NOTHING;
    END LOOP;
    IF COALESCE(j->>'body','')='' AND NOT EXISTS(SELECT 1 FROM public.message_release_assets WHERE item_id=item) THEN RAISE EXCEPTION 'Empty message'; END IF;
   END LOOP;
   INSERT INTO public.recipient_deliveries(recipient_id) SELECT rr.id FROM public.message_release_recipients rr WHERE rr.release_id=rid;
   UPDATE public.guardian_escalations SET status='released',closed_at=n WHERE id=e.id;
   IF r.safety_deadline_at>n THEN UPDATE public.release_acceleration_authorizations SET consumed_at=n WHERE id=a.id; END IF;
   outcome:='released'; UPDATE public.message_release_checks SET outcome_code=outcome,error_sqlstate=NULL WHERE message_release_checks.escalation_id=candidate.id; RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
   -- Per-escalation savepoint: no partial release or partial recipient groups.
   outcome:='blocked'; UPDATE public.message_release_checks SET outcome_code=outcome,error_sqlstate=SQLSTATE WHERE message_release_checks.escalation_id=candidate.id; RETURN NEXT;
  END;
 END LOOP;
END $$;

CREATE FUNCTION public.claim_recipient_delivery() RETURNS SETOF public.recipient_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.private_delivery_settings WHERE singleton AND delivery_enabled) THEN RETURN; END IF;
 WITH stale AS (SELECT id FROM public.recipient_deliveries WHERE status IN ('claimed','sending') AND lease_expires_at<=clock_timestamp() ORDER BY lease_expires_at LIMIT 25 FOR UPDATE SKIP LOCKED)
 UPDATE public.recipient_deliveries d SET status=CASE WHEN d.status='sending' THEN 'uncertain' ELSE 'pending' END,
 outcome_code=CASE WHEN d.status='sending' THEN 'SEND_OUTCOME_UNKNOWN' ELSE 'CLAIM_RECOVERED' END,claim_token=NULL,lease_expires_at=NULL FROM stale WHERE d.id=stale.id;
 RETURN QUERY WITH candidate AS (
 SELECT d.id FROM public.recipient_deliveries d JOIN public.message_release_recipients rr ON rr.id=d.recipient_id
 JOIN public.message_releases r ON r.id=rr.release_id WHERE d.status='pending' AND d.available_at<=clock_timestamp() AND r.revoked_at IS NULL
 ORDER BY d.available_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED)
 UPDATE public.recipient_deliveries d SET status='claimed',claim_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '2 minutes',attempt_count=d.attempt_count+1
 FROM candidate WHERE d.id=candidate.id RETURNING d.*;
END $$;
CREATE FUNCTION public.reserve_recipient_send(p_id uuid,p_claim uuid,p_digest text) RETURNS TABLE(email text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.recipient_deliveries%rowtype;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.private_delivery_settings WHERE singleton AND delivery_enabled) THEN RETURN; END IF;
 UPDATE public.recipient_deliveries x SET status='sending',send_started_at=clock_timestamp(),token_digest=p_digest,token_expires_at=clock_timestamp()+interval '30 days'
 WHERE x.id=p_id AND x.claim_token=p_claim AND x.status='claimed' AND x.lease_expires_at>clock_timestamp()+interval '20 seconds'
 AND EXISTS(SELECT 1 FROM public.message_release_recipients rr JOIN public.message_releases r ON r.id=rr.release_id WHERE rr.id=x.recipient_id AND r.revoked_at IS NULL)
 RETURNING x.* INTO d;
 IF FOUND THEN RETURN QUERY SELECT rr.email,d.token_expires_at FROM public.message_release_recipients rr WHERE rr.id=d.recipient_id; END IF;
END $$;
CREATE FUNCTION public.finish_recipient_send(p_id uuid,p_claim uuid,p_outcome text,p_provider_id text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_outcome NOT IN ('accepted','failed','uncertain') OR (p_outcome='accepted' AND COALESCE(length(p_provider_id),0)=0) THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
 UPDATE public.recipient_deliveries SET status=p_outcome,provider_message_id=p_provider_id,
 accepted_at=CASE WHEN p_outcome='accepted' THEN clock_timestamp() END,
 outcome_code=CASE p_outcome WHEN 'accepted' THEN 'PROVIDER_ACCEPTED' WHEN 'failed' THEN 'PROVIDER_REJECTED' ELSE 'SEND_OUTCOME_UNKNOWN' END,
 claim_token=NULL,lease_expires_at=NULL
 WHERE id=p_id AND claim_token=p_claim AND status='sending';
 RETURN FOUND;
END $$;
CREATE FUNCTION public.recipient_access(p_digest text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT rr.id FROM public.recipient_deliveries d JOIN public.message_release_recipients rr ON rr.id=d.recipient_id
 JOIN public.message_releases r ON r.id=rr.release_id WHERE d.token_digest=p_digest AND d.token_expires_at>statement_timestamp()
 AND d.status IN ('sending','accepted','uncertain') AND r.revoked_at IS NULL
$$;

-- No browser reads, including snapshots, hashes, recipient addresses or consent audit.
DO $$ DECLARE t text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['private_delivery_settings','message_release_checks','message_releases','message_release_recipients','message_release_items','message_release_assets','recipient_deliveries','release_acceleration_authorizations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
 ('guard_released_message','guard_released_storage','release_encryption_valid','authorize_release_acceleration','arm_release_acceleration','revoke_release_acceleration','process_private_message_releases','claim_recipient_delivery','reserve_recipient_send','finish_recipient_send','recipient_access') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.authorize_release_acceleration(uuid,text,text),public.revoke_release_acceleration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.arm_release_acceleration(uuid),public.process_private_message_releases(uuid),public.claim_recipient_delivery(),public.reserve_recipient_send(uuid,uuid,text),public.finish_recipient_send(uuid,uuid,text,text),public.recipient_access(text) TO service_role;
-- Operator activation/revocation uses a privileged migration/session, never browser DML.
COMMIT;

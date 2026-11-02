-- Approved policy: finish started continuity processes; never start a new cycle
-- after promotional expiry without another valid plan. No state reset/backfill.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.promotion_campaign DROP CONSTRAINT promotion_campaign_expiry_policy_check;
-- Installation does not enable redemption or notifications.
UPDATE public.promotion_campaign SET enabled=false,expiry_policy='read_only_finish_started_cycles_v1';
ALTER TABLE public.promotion_campaign ADD CONSTRAINT promotion_campaign_expiry_policy_check
 CHECK(expiry_policy='read_only_finish_started_cycles_v1');

CREATE FUNCTION public.promotion_writes_allowed(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.promotional_access WHERE user_id=p_user_id AND expires_at<=transaction_timestamp())
 OR public.has_paid_plan(p_user_id);
$$;
REVOKE ALL ON FUNCTION public.promotion_writes_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.promotion_writes_allowed(uuid) TO service_role;
CREATE FUNCTION public.promotion_owner_writes_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND public.promotion_writes_allowed(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.promotion_owner_writes_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.promotion_owner_writes_allowed() TO authenticated;
CREATE FUNCTION public.get_promotion_permissions() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('writes_allowed',public.promotion_owner_writes_allowed(),
 'evaluated_at',transaction_timestamp(),'promotion',public.get_promotional_access());
$$;
REVOKE ALL ON FUNCTION public.get_promotion_permissions() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_promotion_permissions() TO authenticated;

CREATE FUNCTION public.guard_promotion_message_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id uuid; row_data jsonb; v_message_id uuid;
BEGIN
 row_data:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 owner_id:=(row_data->>'user_id')::uuid;
 v_message_id:=CASE WHEN TG_TABLE_NAME='messages' THEN (row_data->>'id')::uuid ELSE (row_data->>'message_id')::uuid END;
 IF owner_id IS NULL THEN SELECT m.user_id INTO owner_id FROM public.messages m WHERE m.id=v_message_id; END IF;
 IF public.promotion_writes_allowed(owner_id) THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 -- Whole-message deletion remains available through existing safety checks.
 -- No content change may be smuggled alongside its tombstone transition.
 IF TG_TABLE_NAME='messages' AND TG_OP='UPDATE' THEN
   IF (to_jsonb(NEW)-'deletion_state'-'updated_at')=(to_jsonb(OLD)-'deletion_state'-'updated_at')
     AND OLD.deletion_state='active' AND NEW.deletion_state='deleting'
     AND EXISTS(SELECT 1 FROM public.message_deletion_requests r WHERE r.message_id=v_message_id AND r.user_id=owner_id AND r.finalized_at IS NULL) THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.message_deletion_requests r WHERE r.message_id=v_message_id AND r.user_id=owner_id AND r.finalizing) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'PROMOTION_EXPIRED_READ_ONLY' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public.guard_promotion_message_write() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER promotion_message_writes BEFORE INSERT OR UPDATE ON public.messages
 FOR EACH ROW EXECUTE FUNCTION public.guard_promotion_message_write();
CREATE TRIGGER promotion_photo_writes BEFORE INSERT OR UPDATE OR DELETE ON public.message_photos
 FOR EACH ROW EXECUTE FUNCTION public.guard_promotion_message_write();
CREATE TRIGGER promotion_video_writes BEFORE INSERT OR UPDATE OR DELETE ON public.message_videos
 FOR EACH ROW EXECUTE FUNCTION public.guard_promotion_message_write();
CREATE TRIGGER promotion_document_writes BEFORE INSERT OR UPDATE OR DELETE ON public.message_documents
 FOR EACH ROW EXECUTE FUNCTION public.guard_promotion_message_write();
CREATE TRIGGER promotion_upload_registration BEFORE INSERT ON public.message_upload_operations
 FOR EACH ROW EXECUTE FUNCTION public.guard_promotion_message_write();
-- Restrictive policies add to owner/path policies; never broaden access.
CREATE POLICY promotion_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id NOT IN ('message-audio','message-videos','message-photos','message-documents') OR public.promotion_owner_writes_allowed());
CREATE POLICY promotion_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING(bucket_id NOT IN ('message-audio','message-videos','message-photos','message-documents') OR public.promotion_owner_writes_allowed())
 WITH CHECK(bucket_id NOT IN ('message-audio','message-videos','message-photos','message-documents') OR public.promotion_owner_writes_allowed());
CREATE POLICY promotion_storage_direct_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id NOT IN ('message-audio','message-videos','message-photos','message-documents') OR public.promotion_owner_writes_allowed());

CREATE FUNCTION public.guard_promotion_check_in_configuration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.promotion_writes_allowed(NEW.user_id) THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN RAISE EXCEPTION 'PROMOTION_EXPIRED_READ_ONLY' USING ERRCODE='42501'; END IF;
 IF NEW.frequency_days IS DISTINCT FROM OLD.frequency_days OR (NEW.enabled AND NOT OLD.enabled) THEN
   RAISE EXCEPTION 'PROMOTION_EXPIRED_READ_ONLY' USING ERRCODE='42501';
 END IF;
 -- Confirmations, response deadlines, failures, generation and escalation state
 -- are deliberately unaffected. Only the engine predicate blocks new cycles.
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_promotion_check_in_configuration() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER promotion_check_in_configuration BEFORE INSERT OR UPDATE ON public.check_ins
 FOR EACH ROW EXECUTE FUNCTION public.guard_promotion_check_in_configuration();
CREATE FUNCTION public.promotion_cycle_allowed(p_user_id uuid,p_status text,p_missed_count integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.promotion_writes_allowed(p_user_id) OR p_status<>'scheduled' OR p_missed_count>0;
$$;
REVOKE ALL ON FUNCTION public.promotion_cycle_allowed(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.promotion_cycle_allowed(uuid,text,integer) TO service_role;
-- Preserve the deployed engine body, timing policy, row locks and side effects.
-- Refuse unknown definitions instead of silently replacing a different engine.
DO $$ DECLARE definition text; needle text:='where c.enabled = true'; BEGIN
 SELECT pg_get_functiondef('public.process_continuity_engine()'::regprocedure) INTO definition;
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
 OR position('public.continuity_timing_policy' IN definition)=0
 OR position('for update skip locked' IN lower(definition))=0 THEN
   RAISE EXCEPTION 'Continuity engine requires reviewed compatibility patch';
 END IF;
 EXECUTE replace(definition,needle,needle||E'\n      and public.promotion_cycle_allowed(c.user_id,c.status,c.missed_count)');
END $$;

CREATE TABLE public.promotion_notice_settings(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.promotion_notice_settings(singleton) VALUES(true);
CREATE TABLE public.promotion_expiry_notices(
 user_id uuid NOT NULL REFERENCES public.promotional_access(user_id),
 days_before integer NOT NULL CHECK(days_before IN (30,7)),
 due_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','uncertain','invalid','skipped')),
 claim_token uuid,claimed_at timestamptz,finished_at timestamptz,provider_id text,
 PRIMARY KEY(user_id,days_before)
);
ALTER TABLE public.promotion_notice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_expiry_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotion_notice_settings,public.promotion_expiry_notices FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,UPDATE ON public.promotion_notice_settings TO service_role;
CREATE FUNCTION public.claim_promotion_expiry_notice()
RETURNS TABLE(user_id uuid,days_before integer,claim_token uuid,email text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.promotion_expiry_notices%rowtype; v_now timestamptz:=clock_timestamp();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.promotion_notice_settings s WHERE s.enabled) THEN RETURN; END IF;
 INSERT INTO public.promotion_expiry_notices(user_id,days_before,due_at,expires_at)
 SELECT a.user_id,d.days,a.expires_at-make_interval(days=>d.days),a.expires_at
 FROM public.promotional_access a CROSS JOIN (VALUES(30),(7)) AS d(days)
 WHERE a.expires_at-make_interval(days=>d.days)<=v_now AND a.expires_at>v_now
 AND NOT public.has_paid_plan(a.user_id)
 ON CONFLICT DO NOTHING;
 -- Never send a stale 30-day warning at the 7-day threshold, or any after expiry.
 UPDATE public.promotion_expiry_notices x SET status='skipped',finished_at=v_now
 WHERE x.status='pending' AND (x.expires_at<=v_now OR public.has_paid_plan(x.user_id)
 OR (x.days_before=30 AND x.expires_at-interval '7 days'<=v_now));
 -- No automatic retries after submission, even beyond provider idempotency TTL.
 UPDATE public.promotion_expiry_notices x SET status='uncertain',finished_at=v_now
 WHERE x.status='sending' AND x.claimed_at<=v_now-interval '5 minutes';
 SELECT x.* INTO n FROM public.promotion_expiry_notices x WHERE x.status='pending'
 ORDER BY x.due_at,x.user_id,x.days_before LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.promotion_expiry_notices x SET status='sending',claim_token=gen_random_uuid(),claimed_at=v_now
 WHERE x.user_id=n.user_id AND x.days_before=n.days_before RETURNING x.* INTO n;
 RETURN QUERY SELECT n.user_id,n.days_before,n.claim_token,u.email,n.expires_at FROM auth.users u WHERE u.id=n.user_id;
END $$;
CREATE FUNCTION public.finish_promotion_expiry_notice(p_user_id uuid,p_days integer,p_claim uuid,p_status text,p_provider_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('accepted','uncertain','invalid') THEN RAISE EXCEPTION 'Invalid notice outcome'; END IF;
 UPDATE public.promotion_expiry_notices SET status=p_status,provider_id=p_provider_id,finished_at=clock_timestamp()
 WHERE user_id=p_user_id AND days_before=p_days AND claim_token=p_claim AND status='sending';
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.claim_promotion_expiry_notice(),public.finish_promotion_expiry_notice(uuid,integer,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_promotion_expiry_notice(),public.finish_promotion_expiry_notice(uuid,integer,uuid,text,text) TO service_role;

-- Read-only operational evidence; no hashes, codes or account identities.
CREATE FUNCTION public.social_promotion_readiness() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('policy_version','read_only_finish_started_cycles_v1',
 'campaign_enabled',(SELECT enabled FROM public.promotion_campaign),
 'expiry_policy',(SELECT expiry_policy FROM public.promotion_campaign),
 'notices_enabled',(SELECT enabled FROM public.promotion_notice_settings),
 'engine_gated',position('promotion_cycle_allowed' IN pg_get_functiondef('public.process_continuity_engine()'::regprocedure))>0,
 'inventory',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM (
   SELECT platform,count(*) AS total,count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM public.promotional_access a WHERE a.code_digest=p.digest)) AS available
   FROM public.promotion_codes p GROUP BY platform ORDER BY platform) c),
 'benefits',(SELECT count(*) FROM public.promotional_access),
 'notice_outcomes',(SELECT coalesce(jsonb_object_agg(status,n),'{}'::jsonb) FROM (SELECT status,count(*) n FROM public.promotion_expiry_notices GROUP BY status) x));
$$;
REVOKE ALL ON FUNCTION public.social_promotion_readiness() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.social_promotion_readiness() TO service_role;
COMMIT;

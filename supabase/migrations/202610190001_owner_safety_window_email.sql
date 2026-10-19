-- Apply after 202610100005 and 202610120001. No provider calls or message release.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- Discover only the exact legacy constraint; refuse unexpected schema drift.
DO $migration$
DECLARE names text[]; n text;
BEGIN
 SELECT array_agg(conname) INTO names FROM pg_catalog.pg_constraint
 WHERE conrelid='public.continuity_email_outbox'::regclass AND contype='c'
 AND pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(oid), '[[:space:]()]', '', 'g')
   = 'CHECKevent_type=''check_in_request''::text';
 IF cardinality(names) IS DISTINCT FROM 1 THEN
   RAISE EXCEPTION 'Expected exactly one legacy event_type constraint';
 END IF;
 n:=names[1];
 EXECUTE format('ALTER TABLE public.continuity_email_outbox DROP CONSTRAINT %I', n);
END;
$migration$;
ALTER TABLE public.continuity_email_outbox
 ADD COLUMN escalation_id uuid REFERENCES public.guardian_escalations(id) ON DELETE CASCADE,
 ADD CONSTRAINT continuity_email_outbox_event_type_check
 CHECK (event_type IN ('check_in_request','owner_safety_window')),
 ADD CONSTRAINT continuity_email_outbox_safety_identity_check CHECK (
 (event_type='check_in_request' AND escalation_id IS NULL) OR
 (event_type='owner_safety_window' AND escalation_id IS NOT NULL
  AND user_id IS NOT NULL AND check_in_id IS NOT NULL AND response_deadline_at IS NOT NULL));
CREATE UNIQUE INDEX continuity_email_outbox_safety_unique
 ON public.continuity_email_outbox(escalation_id) WHERE event_type='owner_safety_window';

-- Called only with the parent/escalation locks already held by the voting RPC
-- or recovery below. Dates and the frozen identity are read, never changed.
CREATE FUNCTION public.enqueue_owner_safety_window_email(p_escalation_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' SET "TimeZone"='UTC'
AS $function$
 INSERT INTO public.continuity_email_outbox
 (user_id,check_in_id,event_type,escalation_id,response_deadline_at)
 SELECT e.user_id,e.check_in_id,'owner_safety_window',e.id,r.safety_deadline_at
 FROM public.guardian_escalations e
 JOIN public.check_ins c ON c.id=e.check_in_id AND c.user_id=e.user_id
 JOIN public.guardian_verification_rounds r ON r.escalation_id=e.id
 WHERE e.id=p_escalation_id AND e.status='safety_window'
 AND e.closed_at IS NULL AND e.owner_checked_in_at IS NULL
 AND c.enabled AND c.status='escalation_pending' AND c.escalation_generation=e.generation
 AND r.majority_reached_at IS NOT NULL
 AND r.safety_deadline_at=r.majority_reached_at+interval '48 hours'
 AND r.safety_deadline_at>pg_catalog.clock_timestamp()
 ON CONFLICT (escalation_id) WHERE event_type='owner_safety_window' DO NOTHING;
$function$;
REVOKE ALL ON FUNCTION public.enqueue_owner_safety_window_email(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.owner_safety_window_email_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET "TimeZone"='UTC'
AS $function$
BEGIN
 IF NEW.status='safety_window' AND OLD.status IS DISTINCT FROM NEW.status THEN
   PERFORM public.enqueue_owner_safety_window_email(NEW.id);
 ELSIF OLD.status='safety_window' AND NEW.status IS DISTINCT FROM OLD.status THEN
   UPDATE public.continuity_email_outbox SET delivery_status='cancelled',
     last_error='SAFETY_WINDOW_INACTIVE',updated_at=pg_catalog.clock_timestamp()
   WHERE escalation_id=NEW.id AND event_type='owner_safety_window' AND delivery_status='pending';
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.owner_safety_window_email_transition() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER owner_safety_window_email_transition
 AFTER UPDATE OF status ON public.guardian_escalations
 FOR EACH ROW EXECUTE FUNCTION public.owner_safety_window_email_transition();

-- Bounded recovery for already-active windows. Same lock order as voting and
-- owner cancellation. Uncertain/failed/sent rows are never recreated or retried.
CREATE FUNCTION public.recover_owner_safety_window_emails()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET "TimeZone"='UTC'
AS $function$
DECLARE candidate record;
BEGIN
 FOR candidate IN
   SELECT e.id,e.check_in_id FROM public.guardian_escalations e
   JOIN public.check_ins c ON c.id=e.check_in_id AND c.user_id=e.user_id
   JOIN public.guardian_verification_rounds r ON r.escalation_id=e.id
   WHERE e.status='safety_window' AND r.safety_deadline_at>pg_catalog.clock_timestamp()
   AND NOT EXISTS (SELECT 1 FROM public.continuity_email_outbox o
     WHERE o.escalation_id=e.id AND o.event_type='owner_safety_window')
   ORDER BY e.id LIMIT 25 FOR UPDATE OF c SKIP LOCKED
 LOOP
   PERFORM e.id FROM public.guardian_escalations e WHERE e.id=candidate.id FOR UPDATE;
   PERFORM public.enqueue_owner_safety_window_email(candidate.id);
 END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.recover_owner_safety_window_emails() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.recover_owner_safety_window_emails() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_continuity_email_events()
 RETURNS SETOF continuity_email_outbox
 LANGUAGE plpgsql
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_now timestamptz;
BEGIN
  PERFORM public.recover_owner_safety_window_emails();
  -- Recovery inserts use clock_timestamp(); include them in this same claim.
  v_now := pg_catalog.clock_timestamp();
  -- Un lease vencido NO se reintenta automáticamente.
  -- Su resultado puede ser desconocido.
  WITH expired AS (
    SELECT o.id
    FROM public.continuity_email_outbox AS o
    WHERE o.event_type IN ('check_in_request', 'owner_safety_window')
      AND o.delivery_status = 'processing'
      AND o.lease_expires_at <= v_now
    ORDER BY o.lease_expires_at, o.id
    LIMIT 25
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.continuity_email_outbox AS o
  SET
    delivery_status = 'uncertain',
    claim_token = NULL,
    claimed_at = NULL,
    lease_expires_at = NULL,
    last_error = 'LEASE_EXPIRED_OUTCOME_UNKNOWN',
    updated_at = v_now
  FROM expired AS e
  WHERE o.id = e.id
    AND o.delivery_status = 'processing'
    AND o.lease_expires_at <= v_now;

  -- Reclamar atómicamente un máximo de 25 eventos pendientes.
  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM public.continuity_email_outbox AS o
    WHERE o.event_type IN ('check_in_request', 'owner_safety_window')
      AND o.delivery_status = 'pending'
      AND o.available_at <= v_now
    ORDER BY o.available_at, o.created_at, o.id
    LIMIT 25
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.continuity_email_outbox AS o
  SET
    delivery_status = 'processing',
    claim_token = gen_random_uuid(),
    claimed_at = v_now,
    lease_expires_at = v_now + interval '10 minutes',
    last_attempt_at = v_now,
    attempt_count = o.attempt_count + 1,
    last_error = NULL,
    updated_at = v_now
  FROM candidates AS c
  WHERE o.id = c.id
    AND o.delivery_status = 'pending'
    AND o.available_at <= v_now
  RETURNING o.*;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_continuity_email_events() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_continuity_email_events() TO service_role;
COMMIT;

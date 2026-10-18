BEGIN;

-- Separate, invoker-rights RPC: the existing scheduler function is untouched.
CREATE OR REPLACE FUNCTION public.claim_continuity_email_events_for_owner(
  p_user_id uuid, p_limit integer
)
RETURNS SETOF public.continuity_email_outbox
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
SET "TimeZone" TO 'UTC'
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_user_id IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_limit > 2 THEN
    RAISE EXCEPTION 'Invalid owner or claim limit' USING ERRCODE = '22023';
  END IF;

  WITH expired AS (
    SELECT o.id
    FROM public.continuity_email_outbox AS o
    WHERE o.user_id = p_user_id
      AND o.event_type = 'check_in_request'
      AND o.delivery_status = 'processing'
      AND o.lease_expires_at <= v_now
    ORDER BY o.lease_expires_at, o.id
    LIMIT p_limit
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.continuity_email_outbox AS o
  SET delivery_status = 'uncertain', claim_token = NULL, claimed_at = NULL,
      lease_expires_at = NULL, last_error = 'LEASE_EXPIRED_OUTCOME_UNKNOWN', updated_at = v_now
  FROM expired AS e
  WHERE o.id = e.id AND o.user_id = p_user_id
    AND o.delivery_status = 'processing' AND o.lease_expires_at <= v_now;

  RETURN QUERY
  WITH candidates AS (
    SELECT o.id
    FROM public.continuity_email_outbox AS o
    WHERE o.user_id = p_user_id
      AND o.event_type = 'check_in_request'
      AND o.delivery_status = 'pending'
      AND o.available_at <= v_now
    ORDER BY o.available_at, o.created_at, o.id
    LIMIT p_limit
    FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.continuity_email_outbox AS o
  SET delivery_status = 'processing', claim_token = pg_catalog.gen_random_uuid(),
      claimed_at = v_now, lease_expires_at = v_now + interval '10 minutes',
      last_attempt_at = v_now, attempt_count = o.attempt_count + 1,
      last_error = NULL, updated_at = v_now
  FROM candidates AS c
  WHERE o.id = c.id AND o.user_id = p_user_id
    AND o.delivery_status = 'pending' AND o.available_at <= v_now
  RETURNING o.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_continuity_email_events_for_owner(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_continuity_email_events_for_owner(uuid, integer) TO service_role;
COMMIT;

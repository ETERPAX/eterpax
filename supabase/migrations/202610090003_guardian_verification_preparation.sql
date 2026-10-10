-- Change 4: prepare one existing escalation, without issuing credentials or mail.
-- Requires Changes 1-3 and both Change 4 structural migrations. No backfill.
-- Installation does not invoke the function or enable an automatic worker.
begin;

create function public.prepare_guardian_verification(p_escalation_id uuid)
returns table (
  escalation_id uuid,
  outcome text,
  request_count integer,
  prepared_at timestamptz,
  dispatch_deadline_at timestamptz
)
language plpgsql
security definer
set search_path to ''
set "TimeZone" to 'UTC'
as $function$
declare
  v_parent_id uuid;
  v_parent public.check_ins%rowtype;
  v_escalation public.guardian_escalations%rowtype;
  v_round public.guardian_verification_rounds%rowtype;
  v_has_round boolean;
  v_participant_ids uuid[];
  v_request_ids uuid[];
  v_snapshot_valid boolean;
  v_request_times_valid boolean;
  v_now timestamptz;
  v_inserted integer;
begin
  if p_escalation_id is null then
    raise exception 'Escalation ID required' using errcode = '22023';
  end if;

  -- Identity lookup only: never lock a child before the parent.
  select e.check_in_id into v_parent_id
  from public.guardian_escalations as e
  where e.id = p_escalation_id;
  if not found then
    raise exception 'Escalation not found' using errcode = 'P0002';
  end if;

  select c.* into v_parent
  from public.check_ins as c
  where c.id = v_parent_id
  for update;
  if not found then
    raise exception 'Check-in not found' using errcode = 'P0002';
  end if;

  select e.* into v_escalation
  from public.guardian_escalations as e
  where e.id = p_escalation_id
  for update;
  if not found then
    raise exception 'Escalation no longer exists' using errcode = 'P0002';
  end if;
  if v_escalation.check_in_id is distinct from v_parent.id
    or v_escalation.user_id is distinct from v_parent.user_id then
    raise exception 'Escalation parent identity changed' using errcode = '23514';
  end if;

  escalation_id := p_escalation_id;
  outcome := 'ineligible';
  request_count := 0;
  prepared_at := null;
  dispatch_deadline_at := null;

  -- Cancellation, safety and every terminal state are no-write outcomes.
  -- Ineligible returns are not a request inventory: timestamps are NULL/count 0.
  if v_parent.enabled is distinct from true
    or v_parent.status is distinct from 'escalation_pending'
    or v_parent.missed_count is distinct from 3
    or v_parent.next_check_in_at is not null
    or v_parent.response_deadline_at is not null
    or v_escalation.generation is distinct from v_parent.escalation_generation
    or v_escalation.status is distinct from 'waiting_for_responses'
    or v_escalation.closed_at is not null
    or v_escalation.owner_checked_in_at is not null then
    return next;
    return;
  end if;

  -- Read the complete frozen set once. Its supported writers are protected;
  -- service_role cannot mutate it. Never consult live Guardian membership.
  select pg_catalog.array_agg(p.source_guardian_id order by p.source_guardian_id),
    pg_catalog.count(*) between 2 and 6
    and pg_catalog.count(p.source_guardian_id) = pg_catalog.count(*)
    and pg_catalog.count(distinct p.source_guardian_id) = pg_catalog.count(*)
    and pg_catalog.count(distinct p.email) = pg_catalog.count(*)
    and coalesce(pg_catalog.bool_and(
      p.name is not null and p.name = pg_catalog.btrim(p.name)
      and pg_catalog.length(p.name) between 1 and 254
      and p.relationship is not null and p.relationship = pg_catalog.btrim(p.relationship)
      and pg_catalog.length(p.relationship) between 1 and 254
      and p.email is not null and p.email = pg_catalog.lower(pg_catalog.btrim(p.email))
      and pg_catalog.length(p.email) between 1 and 254
      and p.email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    ), false)
  into v_participant_ids, v_snapshot_valid
  from public.guardian_escalation_participants as p
  where p.escalation_id = p_escalation_id;
  if v_snapshot_valid is distinct from true then
    raise exception 'Invalid frozen participant set' using errcode = '23514';
  end if;

  select r.* into v_round
  from public.guardian_verification_rounds as r
  where r.escalation_id = p_escalation_id
  for update;
  v_has_round := found;

  perform q.source_guardian_id
  from public.guardian_verification_requests as q
  where q.escalation_id = p_escalation_id
  order by q.source_guardian_id
  for update;

  select pg_catalog.array_agg(q.source_guardian_id order by q.source_guardian_id),
    coalesce(pg_catalog.bool_and(q.created_at = v_round.prepared_at), false)
  into v_request_ids, v_request_times_valid
  from public.guardian_verification_requests as q
  where q.escalation_id = p_escalation_id;

  -- Capture actual time only after all blocking locks have been acquired.
  v_now := pg_catalog.clock_timestamp();
  if v_has_round then
    if v_request_ids is distinct from v_participant_ids
      or v_request_times_valid is distinct from true
      or v_round.dispatch_deadline_at is distinct from v_round.prepared_at + interval '24 hours'
      or v_round.dispatch_exhausted_at is not null
      or v_round.operational_incident_code is not null
      or v_round.majority_reached_at is not null
      or v_round.safety_deadline_at is not null then
      -- Waiting + exhausted/majority is an inconsistent cross-table state.
      -- Partial preparation must not be silently repaired or have its clock reset.
      raise exception 'Inconsistent existing verification preparation' using errcode = '23514';
    end if;

    request_count := pg_catalog.cardinality(v_request_ids);
    prepared_at := v_round.prepared_at;
    dispatch_deadline_at := v_round.dispatch_deadline_at;
    if v_round.first_accepted_at is null and v_now >= v_round.dispatch_deadline_at then
      outcome := 'dispatch_expired';
    elsif v_round.response_deadline_at is not null and v_now >= v_round.response_deadline_at then
      outcome := 'ineligible';
    else
      outcome := 'already_prepared';
    end if;
    -- Expiry/incident transitions belong to a later locked writer. No writes here.
    -- already_prepared is an existence result, not authorization to send or vote.
    return next;
    return;
  end if;

  if v_request_ids is not null then
    raise exception 'Verification requests exist without a round' using errcode = '23514';
  end if;

  -- Parent locking serializes supported callers even when no round exists yet.
  -- Plain INSERT preserves constraint failures; no broad conflict suppression.
  insert into public.guardian_verification_rounds
    (escalation_id, prepared_at, dispatch_deadline_at)
  values (p_escalation_id, v_now, v_now + interval '24 hours');

  insert into public.guardian_verification_requests
    (escalation_id, source_guardian_id, created_at)
  select p_escalation_id, p.source_guardian_id, v_now
  from pg_catalog.unnest(v_participant_ids) as p(source_guardian_id)
  order by p.source_guardian_id;
  get diagnostics v_inserted = row_count;
  if v_inserted <> pg_catalog.cardinality(v_participant_ids) then
    raise exception 'Incomplete verification preparation' using errcode = '23514';
  end if;

  outcome := 'prepared';
  request_count := v_inserted;
  prepared_at := v_now;
  dispatch_deadline_at := v_now + interval '24 hours';
  return next;
  return;
end;
$function$;

alter function public.prepare_guardian_verification(uuid) owner to postgres;
revoke all on function public.prepare_guardian_verification(uuid) from public, anon, authenticated;
grant execute on function public.prepare_guardian_verification(uuid) to service_role;

-- Existing table RLS/ACLs and confirm_check_in() remain unchanged.
-- No credentials, emissions, acceptance timestamps or voting windows are created.
-- Do not activate preparation in a scheduler before dispatch/exhaustion handling
-- is separately approved: preparing starts the 24-hour operational deadline.
commit;

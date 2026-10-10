-- Change 4 complement: multiple credentials, independent emissions and
-- 24-hour operational block, with the approved owner Check-in compatibility.
-- Requires Changes 1-3 and 202610090001_guardian_verification_structure.sql.
-- No backfill, sending, voting, scheduler, release or delivery implementation.
-- Existing notifications cannot be assigned invented payload digests: the new
-- NOT NULL columns deliberately fail on nonempty notification tables. Review
-- any existing data separately; do not weaken constraints or fabricate history.
begin;

alter table public.guardian_escalations
  drop constraint guardian_escalations_status_check,
  drop constraint guardian_escalations_closed_at_check,
  drop constraint guardian_escalations_owner_check_in_check,
  add constraint guardian_escalations_status_check check (status in (
    'waiting_for_responses', 'safety_window', 'stopped_negative',
    'frozen_no_majority', 'cancelled_owner_check_in', 'blocked_invalid_guardian_set',
    'blocked_verification_delivery'
  )),
  add constraint guardian_escalations_closed_at_check check (
    (status in ('waiting_for_responses', 'safety_window') and closed_at is null)
    or (status in ('stopped_negative', 'frozen_no_majority',
      'cancelled_owner_check_in', 'blocked_invalid_guardian_set',
      'blocked_verification_delivery') and closed_at is not null)
  ),
  add constraint guardian_escalations_owner_check_in_check check (
    (status in ('waiting_for_responses', 'safety_window',
      'blocked_verification_delivery') and owner_checked_in_at is null)
    or status in ('stopped_negative', 'frozen_no_majority', 'blocked_invalid_guardian_set')
    or (status = 'cancelled_owner_check_in' and owner_checked_in_at is not null)
  );

-- blocked_verification_delivery is terminal, not an active waiting cycle.
-- Keep guardian_escalations_one_active_per_check_in UNCHANGED. The existing
-- (check_in_id, generation) uniqueness still reserves the blocked generation.
-- Cancellation supplies both non-NULL timestamps required by cancelled status.

drop index public.guardian_verification_tokens_one_open;
create index guardian_verification_tokens_open_by_participant
  on public.guardian_verification_tokens(escalation_id, source_guardian_id, id)
  where consumed_at is null and revoked_at is null;
-- The original token remains usable when a reminder creates a second token.
-- Digest uniqueness, expiry CHECKs, participant FKs and the response PK remain.
-- Future voting must consume one token and invalidate its siblings atomically.

-- The initial migration let PostgreSQL choose the long constraint name.
-- Resolve its exact columns instead of guessing a truncated identifier.
do $constraint$
declare
  v_constraint_name name;
  v_count integer;
begin
  select count(*), min(c.conname::text)::name
  into v_count, v_constraint_name
  from pg_catalog.pg_constraint as c
  where c.conrelid = 'public.guardian_verification_notifications'::regclass
    and c.contype = 'u'
    and array(
      select a.attname::text
      from pg_catalog.unnest(c.conkey) with ordinality as k(attnum, ordinal)
      join pg_catalog.pg_attribute as a
        on a.attrelid = c.conrelid and a.attnum = k.attnum
      order by k.ordinal
    ) = array['escalation_id', 'source_guardian_id', 'kind']::text[];
  if v_count <> 1 then
    raise exception 'Expected exactly one notification logical-identity constraint';
  end if;
  execute pg_catalog.format(
    'alter table public.guardian_verification_notifications drop constraint %I',
    v_constraint_name
  );
end;
$constraint$;

alter table public.guardian_verification_notifications
  add column emission_number integer not null,
  add column payload_digest bytea not null,
  add constraint guardian_verification_emission_number_check
    check (emission_number > 0),
  add constraint guardian_verification_payload_digest_check
    check (octet_length(payload_digest) = 32),
  add constraint guardian_verification_emission_identity_key
    unique (escalation_id, source_guardian_id, kind, emission_number),
  add constraint guardian_verification_emission_token_key unique (token_id);

create unique index guardian_verification_notifications_one_unresolved
  on public.guardian_verification_notifications(escalation_id, source_guardian_id, kind)
  where status in ('queued', 'sending', 'uncertain', 'accepted');
-- UNIQUE(token_id) also supports lookups for the existing composite token FK.
drop index public.guardian_verification_notifications_token;

-- One row is one emission. Its id (with an environment/purpose prefix) is the
-- provider idempotency identity. id, participant, kind, emission_number, token_id
-- and payload_digest are immutable BY CONTRACT in future restricted RPCs.
-- A transport retry retains the identical payload, token and emission ID.
-- A replacement emission needs a fresh token/ID/number after proven resolution.
-- Never move an ambiguous emission to cancelled/failed merely to bypass the
-- partial unique index. Accepted initial and reminder emissions are independent.
-- CHECKs cannot enforce cross-update immutability. No trigger/RPC is added here.
-- Only a digest is stored: lost raw tokens/payloads cannot be reconstructed.

alter table public.guardian_verification_rounds
  add column operational_incident_code text,
  add constraint guardian_verification_rounds_dispatch_24h_check
    check (dispatch_deadline_at = prepared_at + interval '24 hours'),
  add constraint guardian_verification_rounds_first_acceptance_check
    check (first_accepted_at is null or first_accepted_at < dispatch_deadline_at),
  add constraint guardian_verification_rounds_dispatch_incident_check check (
    (dispatch_exhausted_at is null and operational_incident_code is null)
    or (dispatch_exhausted_at is not null and operational_incident_code is not null
      and operational_incident_code = 'no_confirmed_acceptance_24h'
      and isfinite(dispatch_exhausted_at)
      and dispatch_exhausted_at >= dispatch_deadline_at
      and first_accepted_at is null)
  );

-- A future locked writer must record exhaustion/incident and change the parent
-- to blocked_verification_delivery with closed_at set in ONE transaction.
-- At equality with dispatch_deadline_at no first acceptance may start the round.
-- Late provider evidence may update emission history, never reopen the round.
-- Check-in cancellation retains that incident record; it does not rewrite the
-- blocked history of earlier generations. No clock worker is introduced here.
-- Existing seven-day, 72-hour reminder and 48-hour safety CHECKs are unchanged.

-- All five Change 4 tables retain their existing RLS/ACLs and no new policies.
-- ALTER TABLE adds no direct service_role write grants (including new columns).
-- Tokens remain inaccessible to service_role; responses remain unique per voter.
-- Existing guardian_escalations table ACLs are unchanged as in Changes 1-3.

create or replace function public.confirm_check_in()
returns public.check_ins
language plpgsql
security definer
set search_path to ''
set "TimeZone" to 'UTC'
as $function$
declare
  v_user_id uuid;
  v_now timestamptz;
  v_row public.check_ins%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select c.* into v_row
  from public.check_ins as c
  where c.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Check-in configuration not found' using errcode = 'P0002';
  end if;
  if v_row.frequency_days is null or v_row.frequency_days <= 0 then
    raise exception 'Invalid check-in frequency' using errcode = '22023';
  end if;

  -- Cancel active rows even when their generation differs from the parent.
  -- Also lock current-generation terminal history needing acknowledgement.
  perform e.id
  from public.guardian_escalations as e
  where e.check_in_id = v_row.id and e.user_id = v_user_id
    and (
      e.status in ('waiting_for_responses', 'safety_window')
      or (
        e.status = 'blocked_verification_delivery'
        and e.generation = v_row.escalation_generation
      )
      or (
        e.status in ('stopped_negative', 'frozen_no_majority')
        and e.generation = v_row.escalation_generation
        and e.owner_checked_in_at is null
      )
    )
  order by e.id
  for update;

  v_now := pg_catalog.clock_timestamp();

  update public.guardian_escalations as e
  set status = 'cancelled_owner_check_in',
      closed_at = v_now,
      owner_checked_in_at = v_now
  where e.check_in_id = v_row.id and e.user_id = v_user_id
    and e.status in ('waiting_for_responses', 'safety_window');

  -- Only the current generation's delivery block is cancelable.
  -- Preserve its incident evidence in guardian_verification_rounds.
  update public.guardian_escalations as e
  set status = 'cancelled_owner_check_in',
      closed_at = v_now,
      owner_checked_in_at = v_now
  where e.check_in_id = v_row.id and e.user_id = v_user_id
    and e.generation = v_row.escalation_generation
    and e.status = 'blocked_verification_delivery';

  update public.guardian_escalations as e
  set owner_checked_in_at = v_now
  where e.check_in_id = v_row.id and e.user_id = v_user_id
    and e.generation = v_row.escalation_generation
    and e.status in ('stopped_negative', 'frozen_no_majority')
    and e.owner_checked_in_at is null;

  update public.check_ins as c
  set missed_count = 0,
      status = 'scheduled',
      last_check_in_at = v_now,
      next_check_in_at = v_now + v_row.frequency_days * interval '1 day',
      response_deadline_at = null,
      updated_at = v_now,
      escalation_generation = v_row.escalation_generation + 1
  where c.id = v_row.id and c.user_id = v_user_id
  returning c.* into v_row;

  return v_row;
end;
$function$;

alter function public.confirm_check_in() owner to postgres;
revoke all on function public.confirm_check_in() from public, anon;
grant execute on function public.confirm_check_in() to authenticated;

commit;

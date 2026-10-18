-- Change 4: initial emissions only. No worker, provider call, backfill or activation.
-- One emission/attempt per participant in this increment, even after rejection.
-- A fresh reservation is permission for ONE submission by its owning worker.
-- Replaying a reservation NEVER authorizes another submission. Lost payloads and
-- uncertain attempts stay blocked; provider reconciliation is a later increment.
begin;

create table public.guardian_verification_emission_attempts (
  id uuid primary key,
  notification_id uuid not null references public.guardian_verification_notifications(id) on delete cascade,
  claim_id uuid not null unique,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('reserved', 'uncertain', 'accepted', 'rejected')),
  created_at timestamptz not null check (isfinite(created_at)),
  lease_expires_at timestamptz not null,
  uncertain_at timestamptz,
  resolved_at timestamptz,
  provider_message_id text,
  evidence_code text,
  unique (notification_id, attempt_number),
  check (isfinite(lease_expires_at) and lease_expires_at > created_at),
  check (uncertain_at is null or (isfinite(uncertain_at) and uncertain_at >= created_at)),
  check (resolved_at is null or (isfinite(resolved_at) and resolved_at >= created_at
    and (uncertain_at is null or resolved_at >= uncertain_at))),
  check (provider_message_id is null or provider_message_id ~ '^[A-Za-z0-9_-]{1,254}$'),
  check (
    (status = 'reserved' and uncertain_at is null and resolved_at is null
      and provider_message_id is null and evidence_code is null)
    or (status = 'uncertain' and uncertain_at is not null and resolved_at is null
      and provider_message_id is null and evidence_code is not null
      and evidence_code in ('lease_expired', 'transport_unknown'))
    or (status = 'accepted' and resolved_at is not null and provider_message_id is not null
      and evidence_code is not null and evidence_code = 'provider_api_accepted')
    or (status = 'rejected' and resolved_at is not null and provider_message_id is null
      and evidence_code is not null and evidence_code = 'provider_api_rejected')
  )
);
create unique index guardian_verification_attempts_unresolved
  on public.guardian_verification_emission_attempts(notification_id)
  where status in ('reserved', 'uncertain');
alter table public.guardian_verification_emission_attempts enable row level security;
revoke all on public.guardian_verification_emission_attempts from public, anon, authenticated, service_role;

-- Guard persistent identities, including claims after the notification clears its
-- transient claim. No DELETE guard: existing account-deletion cascades still work.
create function public.guard_guardian_verification_emission_identity()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if tg_table_name = 'guardian_verification_emission_attempts' then
    if row(new.id,new.notification_id,new.claim_id,new.attempt_number,new.created_at,new.lease_expires_at)
      is distinct from row(old.id,old.notification_id,old.claim_id,old.attempt_number,old.created_at,old.lease_expires_at)
      or (old.status in ('accepted','rejected') and new is distinct from old)
      or (old.uncertain_at is not null and new.uncertain_at is distinct from old.uncertain_at) then
      raise exception 'Immutable emission attempt' using errcode='23514';
    end if;
  elsif tg_table_name = 'guardian_verification_notifications' then
    if row(new.id,new.escalation_id,new.source_guardian_id,new.kind,new.emission_number,new.token_id,new.payload_digest,new.created_at)
      is distinct from row(old.id,old.escalation_id,old.source_guardian_id,old.kind,old.emission_number,old.token_id,old.payload_digest,old.created_at) then
      raise exception 'Immutable emission identity' using errcode='23514';
    end if;
  else
    if row(new.id,new.escalation_id,new.source_guardian_id,new.token_digest,new.created_at,new.expires_at)
      is distinct from row(old.id,old.escalation_id,old.source_guardian_id,old.token_digest,old.created_at,old.expires_at) then
      raise exception 'Immutable verification credential' using errcode='23514';
    end if;
  end if;
  return new;
end;
$function$;
create trigger guardian_verification_attempt_identity before update on public.guardian_verification_emission_attempts
  for each row execute function public.guard_guardian_verification_emission_identity();
create trigger guardian_verification_emission_identity before update on public.guardian_verification_notifications
  for each row execute function public.guard_guardian_verification_emission_identity();
create trigger guardian_verification_credential_identity before update on public.guardian_verification_tokens
  for each row execute function public.guard_guardian_verification_emission_identity();

-- Private locking primitive; callers may inspect children for identity only before
-- this function. All requests are locked in stable order, including for expiry.
create function public.lock_guardian_verification_emission(p_escalation_id uuid)
returns boolean language plpgsql security definer set search_path to '' as $function$
declare
  v_parent_id uuid;
  c public.check_ins%rowtype;
  e public.guardian_escalations%rowtype;
begin
  select x.check_in_id into v_parent_id from public.guardian_escalations x where x.id=p_escalation_id;
  if not found then raise exception 'Escalation not found' using errcode='P0002'; end if;
  select x.* into c from public.check_ins x where x.id=v_parent_id for update;
  if not found then raise exception 'Parent not found' using errcode='P0002'; end if;
  select x.* into e from public.guardian_escalations x where x.id=p_escalation_id for update;
  if not found or e.check_in_id is distinct from c.id or e.user_id is distinct from c.user_id then
    raise exception 'Escalation identity mismatch' using errcode='23514';
  end if;
  perform 1 from public.guardian_verification_rounds r where r.escalation_id=e.id for update;
  if not found then raise exception 'Preparation required' using errcode='P0002'; end if;
  perform q.source_guardian_id from public.guardian_verification_requests q
    where q.escalation_id=e.id order by q.source_guardian_id for update;
  return c.enabled is true and c.status='escalation_pending' and c.missed_count=3
    and c.next_check_in_at is null and c.response_deadline_at is null
    and e.generation=c.escalation_generation and e.status='waiting_for_responses'
    and e.closed_at is null and e.owner_checked_in_at is null;
end;
$function$;

create function public.expire_guardian_verification_dispatch(p_escalation_id uuid)
returns text language plpgsql security definer set search_path to '' set "TimeZone" to 'UTC' as $function$
declare
  v_eligible boolean;
  r public.guardian_verification_rounds%rowtype;
  v_now timestamptz;
begin
  v_eligible := public.lock_guardian_verification_emission(p_escalation_id);
  select x.* into r from public.guardian_verification_rounds x where x.escalation_id=p_escalation_id;
  if r.dispatch_exhausted_at is not null then return 'already_exhausted'; end if;
  if v_eligible is distinct from true then return 'ineligible'; end if;
  v_now := pg_catalog.clock_timestamp();
  if r.first_accepted_at is not null or v_now < r.dispatch_deadline_at then return 'not_due'; end if;
  update public.guardian_verification_rounds set dispatch_exhausted_at=v_now,
    operational_incident_code='no_confirmed_acceptance_24h' where escalation_id=p_escalation_id;
  update public.guardian_escalations set status='blocked_verification_delivery',closed_at=v_now
    where id=p_escalation_id;
  -- Do not cancel uncertain emissions or release their deduplication barrier.
  return 'blocked_verification_delivery';
end;
$function$;

create function public.reserve_guardian_verification_initial(
  p_escalation_id uuid, p_source_guardian_id uuid, p_emission_id uuid,
  p_attempt_id uuid, p_claim_id uuid, p_token_digest bytea, p_payload_digest bytea)
returns table(outcome text, emission_id uuid, attempt_id uuid, claim_id uuid,
  lease_expires_at timestamptz, token_expires_at timestamptz, recipient_email text)
language plpgsql security definer set search_path to '' set "TimeZone" to 'UTC' as $function$
declare
  v_eligible boolean;
  r public.guardian_verification_rounds%rowtype;
  n public.guardian_verification_notifications%rowtype;
  a public.guardian_verification_emission_attempts%rowtype;
  t public.guardian_verification_tokens%rowtype;
  v_now timestamptz;
  v_lease timestamptz;
  v_expires timestamptz;
  v_email text;
  v_token_id uuid;
  v_participants uuid[];
  v_requests uuid[];
begin
  if p_escalation_id is null or p_source_guardian_id is null or p_emission_id is null
    or p_attempt_id is null or p_claim_id is null or p_token_digest is null or p_payload_digest is null
    or pg_catalog.octet_length(p_token_digest)<>32 or pg_catalog.octet_length(p_payload_digest)<>32 then
    raise exception 'Invalid reservation arguments' using errcode='22023';
  end if;
  v_eligible := public.lock_guardian_verification_emission(p_escalation_id);
  outcome := 'ineligible';
  if v_eligible is distinct from true then return next; return; end if;
  select x.* into r from public.guardian_verification_rounds x where x.escalation_id=p_escalation_id;
  select pg_catalog.array_agg(x.source_guardian_id order by x.source_guardian_id) into v_participants
    from public.guardian_escalation_participants x where x.escalation_id=p_escalation_id;
  select pg_catalog.array_agg(x.source_guardian_id order by x.source_guardian_id) into v_requests
    from public.guardian_verification_requests x where x.escalation_id=p_escalation_id;
  if pg_catalog.cardinality(v_participants) not between 2 and 6 or v_participants is null
    or v_requests is distinct from v_participants
    or exists(select 1 from public.guardian_verification_requests q where q.escalation_id=p_escalation_id
      and q.created_at is distinct from r.prepared_at)
    or r.dispatch_exhausted_at is not null or r.operational_incident_code is not null
    or r.majority_reached_at is not null or r.safety_deadline_at is not null then
    raise exception 'Inconsistent verification preparation' using errcode='23514';
  end if;
  select x.email into v_email from public.guardian_escalation_participants x
    where x.escalation_id=p_escalation_id and x.source_guardian_id=p_source_guardian_id;
  if not found then raise exception 'Participant not in snapshot' using errcode='22023'; end if;
  if exists(select 1 from public.guardian_verification_responses x where x.escalation_id=p_escalation_id
    and x.source_guardian_id=p_source_guardian_id) then return next; return; end if;
  -- Search ALL initial history, not only the partial unique-index predicate.
  -- This increment never replaces failed/cancelled/uncertain initial emissions.
  select x.* into n from public.guardian_verification_notifications x
    where x.escalation_id=p_escalation_id and x.source_guardian_id=p_source_guardian_id and x.kind='initial'
    order by x.emission_number limit 1 for update;
  if found then
    if n.id<>p_emission_id then outcome := 'emission_exists'; return next; return; end if;
    select x.* into a from public.guardian_verification_emission_attempts x
      where x.notification_id=n.id and x.attempt_number=1 for update;
    if not found then raise exception 'Missing emission attempt' using errcode='23514'; end if;
    select x.* into t from public.guardian_verification_tokens x where x.id=n.token_id;
    if a.id<>p_attempt_id or a.claim_id<>p_claim_id or n.payload_digest<>p_payload_digest
      or t.token_digest is distinct from p_token_digest then
      raise exception 'Reservation identity conflict' using errcode='23514';
    end if;
    outcome := 'already_reserved'; -- Never a second authorization to submit.
    emission_id:=n.id; attempt_id:=a.id; claim_id:=a.claim_id;
    lease_expires_at:=a.lease_expires_at; token_expires_at:=t.expires_at;
    return next; return;
  end if;
  v_now := pg_catalog.clock_timestamp();
  if r.first_accepted_at is null and v_now>=r.dispatch_deadline_at then
    perform public.expire_guardian_verification_dispatch(p_escalation_id);
    outcome:='dispatch_expired'; return next; return;
  end if;
  if r.response_deadline_at is not null and v_now>=r.response_deadline_at then return next; return; end if;
  v_lease := least(v_now+interval '60 seconds',coalesce(r.response_deadline_at,r.dispatch_deadline_at));
  -- Upper bound before acceptance; future voting must ALSO enforce common deadline.
  v_expires := coalesce(r.response_deadline_at,r.dispatch_deadline_at+interval '168 hours');
  v_token_id := pg_catalog.gen_random_uuid();
  insert into public.guardian_verification_tokens(id,escalation_id,source_guardian_id,token_digest,created_at,expires_at)
    values(v_token_id,p_escalation_id,p_source_guardian_id,p_token_digest,v_now,v_expires);
  insert into public.guardian_verification_notifications(id,escalation_id,source_guardian_id,kind,token_id,
    status,created_at,available_at,attempt_count,last_attempted_at,claim_id,lease_expires_at,emission_number,payload_digest)
    values(p_emission_id,p_escalation_id,p_source_guardian_id,'initial',v_token_id,
      'sending',v_now,v_now,1,v_now,p_claim_id,v_lease,1,p_payload_digest);
  insert into public.guardian_verification_emission_attempts(id,notification_id,claim_id,attempt_number,status,created_at,lease_expires_at)
    values(p_attempt_id,p_emission_id,p_claim_id,1,'reserved',v_now,v_lease);
  outcome:='reserved'; emission_id:=p_emission_id; attempt_id:=p_attempt_id; claim_id:=p_claim_id;
  lease_expires_at:=v_lease; token_expires_at:=v_expires; recipient_email:=v_email;
  return next;
end;
$function$;

create function public.mark_guardian_verification_attempt_uncertain(p_attempt_id uuid)
returns text language plpgsql security definer set search_path to '' set "TimeZone" to 'UTC' as $function$
declare
  v_escalation_id uuid;
  v_notification_id uuid;
  n public.guardian_verification_notifications%rowtype;
  a public.guardian_verification_emission_attempts%rowtype;
  v_now timestamptz;
begin
  select x.notification_id,y.escalation_id into v_notification_id,v_escalation_id
    from public.guardian_verification_emission_attempts x
    join public.guardian_verification_notifications y on y.id=x.notification_id where x.id=p_attempt_id;
  if not found then raise exception 'Attempt not found' using errcode='P0002'; end if;
  perform public.lock_guardian_verification_emission(v_escalation_id);
  select x.* into n from public.guardian_verification_notifications x where x.id=v_notification_id for update;
  select x.* into a from public.guardian_verification_emission_attempts x where x.id=p_attempt_id for update;
  if a.status<>'reserved' then return 'already_finalized'; end if;
  v_now:=pg_catalog.clock_timestamp();
  if v_now<a.lease_expires_at then return 'not_due'; end if;
  if n.status<>'sending' or n.claim_id is distinct from a.claim_id then
    raise exception 'Attempt ownership mismatch' using errcode='23514';
  end if;
  update public.guardian_verification_emission_attempts set status='uncertain',uncertain_at=v_now,
    evidence_code='lease_expired' where id=a.id;
  update public.guardian_verification_notifications set status='uncertain',claim_id=null,lease_expires_at=null where id=n.id;
  return 'uncertain';
end;
$function$;

create function public.finalize_guardian_verification_attempt(
  p_attempt_id uuid,p_claim_id uuid,p_outcome text,p_provider_message_id text default null)
returns text language plpgsql security definer set search_path to '' set "TimeZone" to 'UTC' as $function$
declare
  v_escalation_id uuid;
  v_notification_id uuid;
  v_eligible boolean;
  r public.guardian_verification_rounds%rowtype;
  n public.guardian_verification_notifications%rowtype;
  a public.guardian_verification_emission_attempts%rowtype;
  v_now timestamptz;
begin
  if p_claim_id is null or p_outcome is null or p_outcome not in ('accepted','rejected','uncertain')
    or (p_outcome='accepted' and (p_provider_message_id is null or p_provider_message_id !~ '^[A-Za-z0-9_-]{1,254}$'))
    or (p_outcome<>'accepted' and p_provider_message_id is not null) then
    raise exception 'Invalid finalization arguments' using errcode='22023';
  end if;
  select x.notification_id,y.escalation_id into v_notification_id,v_escalation_id
    from public.guardian_verification_emission_attempts x
    join public.guardian_verification_notifications y on y.id=x.notification_id where x.id=p_attempt_id;
  if not found then raise exception 'Attempt not found' using errcode='P0002'; end if;
  v_eligible:=public.lock_guardian_verification_emission(v_escalation_id);
  select x.* into r from public.guardian_verification_rounds x where x.escalation_id=v_escalation_id;
  select x.* into n from public.guardian_verification_notifications x where x.id=v_notification_id for update;
  select x.* into a from public.guardian_verification_emission_attempts x where x.id=p_attempt_id for update;
  if a.claim_id is distinct from p_claim_id then raise exception 'Claim mismatch' using errcode='42501'; end if;
  if a.status in ('accepted','rejected') then
    if a.status=p_outcome and a.provider_message_id is not distinct from p_provider_message_id then
      return 'already_finalized';
    end if;
    raise exception 'Conflicting finalization' using errcode='23514';
  end if;
  if (a.status='reserved' and (n.status<>'sending' or n.claim_id is distinct from a.claim_id))
    or (a.status='uncertain' and n.status<>'uncertain') then
    raise exception 'Attempt ownership mismatch' using errcode='23514';
  end if;
  -- Negative reconciliation is deliberately unavailable. A timed-out worker's
  -- later negative report cannot prove that no other request was accepted.
  if a.status='uncertain' and p_outcome='rejected' then return 'reconciliation_required'; end if;
  if a.status='uncertain' and p_outcome='uncertain' then return 'already_finalized'; end if;
  v_now:=pg_catalog.clock_timestamp();
  if p_outcome='uncertain' then
    update public.guardian_verification_emission_attempts set status='uncertain',uncertain_at=v_now,
      evidence_code='transport_unknown' where id=a.id;
    update public.guardian_verification_notifications set status='uncertain',claim_id=null,lease_expires_at=null where id=n.id;
    return 'uncertain';
  end if;
  -- Trusted service assertion of an actual provider API response, NOT SQL
  -- verification of external evidence. No raw provider text accepted or stored.
  update public.guardian_verification_emission_attempts set status=p_outcome,resolved_at=v_now,
    provider_message_id=p_provider_message_id,
    evidence_code=case when p_outcome='accepted' then 'provider_api_accepted' else 'provider_api_rejected' end where id=a.id;
  update public.guardian_verification_notifications set status=case when p_outcome='accepted' then 'accepted' else 'failed' end,
    claim_id=null,lease_expires_at=null,provider_message_id=p_provider_message_id,
    accepted_at=case when p_outcome='accepted' then v_now else null end where id=n.id;
  if p_outcome='rejected' then return 'rejected'; end if;
  if v_eligible is true and r.dispatch_exhausted_at is null then
    if r.first_accepted_at is null then
      if v_now<r.dispatch_deadline_at then
        update public.guardian_verification_rounds set first_accepted_at=v_now,
          reminder_due_at=v_now+interval '72 hours', response_deadline_at=v_now+interval '168 hours'
          where escalation_id=v_escalation_id;
        return 'accepted_window_started';
      else
        -- Locks are already held by this transaction in parent-first order.
        perform public.expire_guardian_verification_dispatch(v_escalation_id);
      end if;
    elsif v_now<r.response_deadline_at then
      return 'accepted';
    end if;
  end if;
  return 'accepted_history_only';
end;
$function$;

alter function public.guard_guardian_verification_emission_identity() owner to postgres;
alter function public.lock_guardian_verification_emission(uuid) owner to postgres;
alter function public.reserve_guardian_verification_initial(uuid,uuid,uuid,uuid,uuid,bytea,bytea) owner to postgres;
alter function public.finalize_guardian_verification_attempt(uuid,uuid,text,text) owner to postgres;
alter function public.mark_guardian_verification_attempt_uncertain(uuid) owner to postgres;
alter function public.expire_guardian_verification_dispatch(uuid) owner to postgres;
revoke all on function public.guard_guardian_verification_emission_identity() from public,anon,authenticated,service_role;
revoke all on function public.lock_guardian_verification_emission(uuid) from public,anon,authenticated,service_role;
revoke all on function public.reserve_guardian_verification_initial(uuid,uuid,uuid,uuid,uuid,bytea,bytea) from public,anon,authenticated,service_role;
revoke all on function public.finalize_guardian_verification_attempt(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.mark_guardian_verification_attempt_uncertain(uuid) from public,anon,authenticated,service_role;
revoke all on function public.expire_guardian_verification_dispatch(uuid) from public,anon,authenticated,service_role;
grant execute on function public.reserve_guardian_verification_initial(uuid,uuid,uuid,uuid,uuid,bytea,bytea),
  public.finalize_guardian_verification_attempt(uuid,uuid,text,text),
  public.mark_guardian_verification_attempt_uncertain(uuid),
  public.expire_guardian_verification_dispatch(uuid) to service_role;
-- No changes to confirm_check_in, public routes, flags or existing table grants.
commit;

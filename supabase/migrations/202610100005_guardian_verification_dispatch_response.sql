-- Guardian Verification: final pre-send eligibility and one-time response.
-- Requires 001-004. No sends, scheduler, backfill or private-message delivery.
begin;

create function public.check_guardian_verification_dispatch(p_attempt_id uuid, p_claim_id uuid)
returns boolean language plpgsql security definer set search_path to '' set "TimeZone" to 'UTC'
as $function$
declare
  v_escalation_id uuid;
  v_notification_id uuid;
  v_eligible boolean;
  r public.guardian_verification_rounds%rowtype;
  n public.guardian_verification_notifications%rowtype;
  a public.guardian_verification_emission_attempts%rowtype;
  v_now timestamptz;
begin
  select x.notification_id,y.escalation_id into v_notification_id,v_escalation_id
    from public.guardian_verification_emission_attempts x
    join public.guardian_verification_notifications y on y.id=x.notification_id where x.id=p_attempt_id;
  if not found or p_claim_id is null then return false; end if;
  v_eligible:=public.lock_guardian_verification_emission(v_escalation_id);
  select x.* into r from public.guardian_verification_rounds x where x.escalation_id=v_escalation_id;
  select x.* into n from public.guardian_verification_notifications x where x.id=v_notification_id for update;
  select x.* into a from public.guardian_verification_emission_attempts x where x.id=p_attempt_id for update;
  v_now:=pg_catalog.clock_timestamp();
  return coalesce(v_eligible and n.kind='initial' and n.status='sending' and a.status='reserved'
    and a.claim_id=p_claim_id and n.claim_id=p_claim_id
    -- Leave enough lease for the 10-second provider call plus finalization.
    and a.lease_expires_at>v_now+interval '15 seconds'
    and n.lease_expires_at=a.lease_expires_at
    and r.dispatch_exhausted_at is null and r.operational_incident_code is null
    and r.majority_reached_at is null and r.safety_deadline_at is null
    and ((r.first_accepted_at is null and r.dispatch_deadline_at>v_now+interval '15 seconds')
      or (r.first_accepted_at is not null and r.response_deadline_at>v_now+interval '15 seconds'))
    and not exists(select 1 from public.guardian_verification_responses v
      where v.escalation_id=n.escalation_id and v.source_guardian_id=n.source_guardian_id)
    and exists(select 1 from public.guardian_verification_tokens t where t.id=n.token_id
      and t.consumed_at is null and t.revoked_at is null and t.expires_at>v_now+interval '15 seconds'),false);
  -- Eligibility at this instant, NOT a guarantee against a later cancellation
  -- while an external provider request is in flight. Never hold SQL locks for mail.
end;
$function$;

create function public.submit_guardian_verification_response(p_token_digest bytea,p_decision text)
returns text language plpgsql security definer set search_path to '' set "TimeZone" to 'UTC'
as $function$
declare
  t public.guardian_verification_tokens%rowtype;
  r public.guardian_verification_rounds%rowtype;
  v_eligible boolean;
  v_now timestamptz;
  v_participants uuid[];
  v_requests uuid[];
  v_total integer;
  v_answered integer;
  v_positive integer;
  v_majority integer;
begin
  if p_token_digest is null or pg_catalog.octet_length(p_token_digest)<>32
    or p_decision is null or p_decision not in ('positive','negative') then
    return 'unavailable';
  end if;
  -- Identity only before parent-first locking. Never expose token inventory.
  select x.* into t from public.guardian_verification_tokens x where x.token_digest=p_token_digest;
  if not found then return 'unavailable'; end if;
  v_eligible:=public.lock_guardian_verification_emission(t.escalation_id);
  if v_eligible is distinct from true then return 'unavailable'; end if;
  select x.* into r from public.guardian_verification_rounds x where x.escalation_id=t.escalation_id;
  -- Lock all sibling credentials in stable order. Parent serializes other writers.
  perform x.id from public.guardian_verification_tokens x where x.escalation_id=t.escalation_id
    and x.source_guardian_id=t.source_guardian_id order by x.id for update;
  select x.* into t from public.guardian_verification_tokens x where x.token_digest=p_token_digest;
  if not found then return 'unavailable'; end if;
  v_now:=pg_catalog.clock_timestamp();
  if t.consumed_at is not null or t.revoked_at is not null or t.created_at>v_now or t.expires_at<=v_now
    or r.first_accepted_at is null or r.first_accepted_at>v_now
    or r.dispatch_exhausted_at is not null or r.operational_incident_code is not null
    or r.majority_reached_at is not null or r.safety_deadline_at is not null
    or exists(select 1 from public.guardian_verification_responses v
      where v.escalation_id=t.escalation_id and v.source_guardian_id=t.source_guardian_id)
    or not exists(select 1 from public.guardian_verification_notifications n
      where n.token_id=t.id and n.status='accepted') then return 'unavailable'; end if;
  if v_now>=r.response_deadline_at then
    update public.guardian_escalations set status='frozen_no_majority',closed_at=v_now where id=t.escalation_id;
    return 'unavailable';
  end if;
  select pg_catalog.array_agg(p.source_guardian_id order by p.source_guardian_id) into v_participants
    from public.guardian_escalation_participants p where p.escalation_id=t.escalation_id;
  select pg_catalog.array_agg(q.source_guardian_id order by q.source_guardian_id) into v_requests
    from public.guardian_verification_requests q where q.escalation_id=t.escalation_id;
  v_total:=pg_catalog.cardinality(v_participants);
  if v_total is null or v_total not between 2 and 6 or v_requests is distinct from v_participants then
    raise exception 'Inconsistent frozen verification set' using errcode='23514';
  end if;
  insert into public.guardian_verification_responses(escalation_id,source_guardian_id,token_id,decision,responded_at)
    values(t.escalation_id,t.source_guardian_id,t.id,p_decision,v_now);
  update public.guardian_verification_tokens set consumed_at=v_now where id=t.id;
  update public.guardian_verification_tokens set revoked_at=v_now where escalation_id=t.escalation_id
    and source_guardian_id=t.source_guardian_id and id<>t.id and consumed_at is null and revoked_at is null;
  select pg_catalog.count(*)::integer,pg_catalog.count(*) filter(where v.decision='positive')::integer
    into v_answered,v_positive from public.guardian_verification_responses v where v.escalation_id=t.escalation_id;
  v_majority:=v_total/2+1;
  if v_positive>=v_majority then
    update public.guardian_verification_rounds set majority_reached_at=v_now,safety_deadline_at=v_now+interval '48 hours'
      where escalation_id=t.escalation_id;
    update public.guardian_escalations set status='safety_window' where id=t.escalation_id;
  elsif v_positive+(v_total-v_answered)<v_majority then
    update public.guardian_escalations set status='frozen_no_majority',closed_at=v_now where id=t.escalation_id;
  end if;
  -- No quorum/owner information is disclosed through this bearer capability.
  return 'recorded';
end;
$function$;
-- Small recoverable batch; the reservation RPC rechecks under locks.
create function public.list_guardian_verification_initial_candidates()
returns table(escalation_id uuid,source_guardian_id uuid)
language sql security definer set search_path to '' set "TimeZone" to 'UTC'
as $function$
  select q.escalation_id,q.source_guardian_id
  from public.guardian_verification_requests q
  join public.guardian_verification_rounds r on r.escalation_id=q.escalation_id
  join public.guardian_escalations e on e.id=q.escalation_id
  join public.check_ins c on c.id=e.check_in_id and c.user_id=e.user_id
  where c.enabled and c.status='escalation_pending' and c.missed_count=3
    and c.escalation_generation=e.generation and c.next_check_in_at is null and c.response_deadline_at is null
    and e.status='waiting_for_responses' and e.closed_at is null and e.owner_checked_in_at is null
    and r.dispatch_exhausted_at is null and r.majority_reached_at is null
    and coalesce(r.response_deadline_at,r.dispatch_deadline_at)>pg_catalog.clock_timestamp()+interval '30 seconds'
    and not exists(select 1 from public.guardian_verification_notifications n
      where n.escalation_id=q.escalation_id and n.source_guardian_id=q.source_guardian_id and n.kind='initial')
    and not exists(select 1 from public.guardian_verification_responses v
      where v.escalation_id=q.escalation_id and v.source_guardian_id=q.source_guardian_id)
  order by r.prepared_at,q.escalation_id,q.source_guardian_id limit 1;
$function$;
alter function public.list_guardian_verification_initial_candidates() owner to postgres;
revoke all on function public.list_guardian_verification_initial_candidates() from public,anon,authenticated,service_role;
grant execute on function public.list_guardian_verification_initial_candidates() to service_role;
alter function public.check_guardian_verification_dispatch(uuid,uuid) owner to postgres;
alter function public.submit_guardian_verification_response(bytea,text) owner to postgres;
revoke all on function public.check_guardian_verification_dispatch(uuid,uuid),
  public.submit_guardian_verification_response(bytea,text) from public,anon,authenticated,service_role;
grant execute on function public.check_guardian_verification_dispatch(uuid,uuid),
  public.submit_guardian_verification_response(bytea,text) to service_role;
commit;

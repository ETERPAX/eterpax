-- Change 3: atomic miss-3 handoff and creation-time participants only.
-- Requires Changes 1 and 2. No backfill of existing pending Check-ins.
begin;

alter table public.guardian_escalations
  drop constraint guardian_escalations_status_check,
  drop constraint guardian_escalations_closed_at_check,
  drop constraint guardian_escalations_owner_check_in_check,
  add constraint guardian_escalations_status_check check (status in (
    'waiting_for_responses', 'safety_window', 'stopped_negative',
    'frozen_no_majority', 'cancelled_owner_check_in', 'blocked_invalid_guardian_set'
  )),
  add constraint guardian_escalations_closed_at_check check (
    (status in ('waiting_for_responses', 'safety_window') and closed_at is null)
    or (status in ('stopped_negative', 'frozen_no_majority',
      'cancelled_owner_check_in', 'blocked_invalid_guardian_set') and closed_at is not null)
  ),
  add constraint guardian_escalations_owner_check_in_check check (
    (status in ('waiting_for_responses', 'safety_window') and owner_checked_in_at is null)
    or status in ('stopped_negative', 'frozen_no_majority', 'blocked_invalid_guardian_set')
    or (status = 'cancelled_owner_check_in' and owner_checked_in_at is not null)
  );

create table public.guardian_escalation_participants (
  escalation_id uuid not null,
  source_guardian_id uuid not null,
  name text not null,
  relationship text not null,
  email text not null,
  primary key (escalation_id, source_guardian_id),
  unique (escalation_id, email),
  foreign key (escalation_id) references public.guardian_escalations(id) on delete cascade,
  check (name = btrim(name) and length(name) between 1 and 254),
  check (relationship = btrim(relationship) and length(relationship) between 1 and 254),
  check (email = lower(btrim(email)) and length(email) between 1 and 254
    and email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$')
);

-- Historical source ID deliberately has no live-Guardian FK.
-- Only the trusted definer writes snapshots; service callers can only read.
alter table public.guardian_escalation_participants enable row level security;
revoke all on public.guardian_escalation_participants from public, anon, authenticated, service_role;
grant select on public.guardian_escalation_participants to service_role;

create or replace function public.process_continuity_engine()
returns table(check_in_id uuid, old_status text, new_status text,
  old_missed_count integer, new_missed_count integer)
language plpgsql
security definer
set search_path to ''
set "TimeZone" to 'UTC'
as $function$
declare
  v_environment text;
  v_response_window interval;
  v_after_miss_1 interval;
  v_after_miss_2 interval;
  v_now timestamptz;
  v_row public.check_ins%rowtype;
  v_old_status text;
  v_old_missed_count integer;
  v_guardians jsonb;
  v_valid boolean;
  v_existing_id uuid;
  v_escalation_id uuid;
begin
  select e.environment into v_environment
  from public.eterpax_environment as e where e.id = true;
  if v_environment is distinct from 'production' then
    raise exception 'Continuity PRODUCTION engine requires PRODUCTION environment'
      using errcode = '42501';
  end if;

  select p.response_window, p.after_miss_1, p.after_miss_2
  into v_response_window, v_after_miss_1, v_after_miss_2
  from public.continuity_timing_policy as p where p.id = true;
  if v_response_window is null or v_after_miss_1 is null or v_after_miss_2 is null
    or v_response_window <= interval '0 seconds'
    or v_after_miss_1 <= interval '0 seconds'
    or v_after_miss_2 <= interval '0 seconds' then
    raise exception 'Invalid or missing continuity timing policy';
  end if;

  v_now := pg_catalog.clock_timestamp();
  for v_row in
    select c.* from public.check_ins as c
    where c.enabled = true and (
      (c.status = 'scheduled' and c.next_check_in_at is not null and c.next_check_in_at <= v_now)
      or (c.status = 'awaiting_response' and c.response_deadline_at is not null and c.response_deadline_at <= v_now)
    )
    order by coalesce(c.next_check_in_at, c.response_deadline_at), c.id
    for update skip locked
    limit 100
  loop
    v_old_status := v_row.status;
    v_old_missed_count := v_row.missed_count;

    if v_row.status = 'scheduled' then
      update public.check_ins as c
      set status = 'awaiting_response', next_check_in_at = null,
          response_deadline_at = v_now + v_response_window, updated_at = v_now
      where c.id = v_row.id;
    elsif v_row.status = 'awaiting_response' and v_row.missed_count = 0 then
      update public.check_ins as c
      set status = 'scheduled', missed_count = 1,
          next_check_in_at = v_row.response_deadline_at + v_after_miss_1,
          response_deadline_at = null, updated_at = v_now
      where c.id = v_row.id;
    elsif v_row.status = 'awaiting_response' and v_row.missed_count = 1 then
      update public.check_ins as c
      set status = 'scheduled', missed_count = 2,
          next_check_in_at = v_row.response_deadline_at + v_after_miss_2,
          response_deadline_at = null, updated_at = v_now
      where c.id = v_row.id;
    elsif v_row.status = 'awaiting_response' and v_row.missed_count = 2
      and v_row.enabled = true and v_row.response_deadline_at is not null
      and v_row.response_deadline_at <= v_now then
      -- One statement snapshot of the COMPLETE set; no independent live reread.
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', g.id, 'name', g.name, 'relationship', g.relationship, 'email', g.email
      ) order by g.id), '[]'::jsonb)
      into v_guardians
      from public.guardians as g where g.user_id = v_row.user_id;

      select count(*) between 2 and 6
        and count(p.id) = count(*) and count(distinct p.id) = count(*)
        and coalesce(bool_and(
          p.name is not null and length(btrim(p.name)) > 0 and length(p.name) <= 254
          and p.relationship is not null and length(btrim(p.relationship)) > 0 and length(p.relationship) <= 254
          and p.email is not null and length(btrim(p.email)) > 0 and length(p.email) <= 254
          and lower(btrim(p.email)) ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
        ), false)
        and count(distinct lower(btrim(p.email))) = count(*)
      into v_valid
      from pg_catalog.jsonb_to_recordset(v_guardians)
        as p(id uuid, name text, relationship text, email text);

      -- Pending rows are never selected again. An identity on an eligible
      -- pre-handoff parent is anomalous: reject rather than rebuild history.
      select e.id into v_existing_id from public.guardian_escalations as e
      where e.check_in_id = v_row.id and e.generation = v_row.escalation_generation
      for update;
      if found then
        raise exception 'Escalation identity already exists for eligible Check-in'
          using errcode = '23514';
      end if;

      update public.check_ins as c
      set status = 'escalation_pending', missed_count = 3,
          next_check_in_at = null, response_deadline_at = null, updated_at = v_now
      where c.id = v_row.id;

      insert into public.guardian_escalations
        (check_in_id, user_id, generation, status, created_at, closed_at, owner_checked_in_at)
      values (v_row.id, v_row.user_id, v_row.escalation_generation,
        case when v_valid then 'waiting_for_responses' else 'blocked_invalid_guardian_set' end,
        v_now, case when v_valid then null else v_now end, null)
      returning id into v_escalation_id;

      if v_valid then
        insert into public.guardian_escalation_participants
          (escalation_id, source_guardian_id, name, relationship, email)
        select v_escalation_id, p.id, btrim(p.name), btrim(p.relationship), lower(btrim(p.email))
        from pg_catalog.jsonb_to_recordset(v_guardians)
          as p(id uuid, name text, relationship text, email text);
      end if;
    else
      continue;
    end if;

    check_in_id := v_row.id;
    old_status := v_old_status;
    old_missed_count := v_old_missed_count;
    select c.status, c.missed_count into new_status, new_missed_count
    from public.check_ins as c where c.id = v_row.id;
    return next;
  end loop;
  return;
end;
$function$;

-- Replacement preserves existing ACL entries. Enforce the server-only boundary.
alter function public.process_continuity_engine() owner to postgres;
revoke all on function public.process_continuity_engine() from public, anon, authenticated;
grant execute on function public.process_continuity_engine() to service_role;

commit;

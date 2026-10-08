-- Change 2: owner cancellation only. Requires the Change 1 foundation.
-- Future escalation writers must lock the parent before escalation rows.
begin;

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

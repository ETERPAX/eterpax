-- Step 1 / Change 1: persistence only. Do not enable escalation creation.
-- The owner Check-in cancellation/generation update is a separate future change.
-- Existing Check-in states, functions, triggers and Guardian notifications stay intact.
begin;

-- Existing and future rows start at generation zero without a Check-in reset.
-- No function or trigger advances generation in this migration.
alter table public.check_ins
  add column escalation_generation bigint not null default 0,
  add constraint check_ins_escalation_generation_nonnegative
    check (escalation_generation >= 0),
  add constraint check_ins_id_user_id_key unique (id, user_id);

create table public.guardian_escalations (
  id uuid primary key default gen_random_uuid(),
  check_in_id uuid not null,
  user_id uuid not null,
  generation bigint not null,
  status text not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  owner_checked_in_at timestamptz,
  constraint guardian_escalations_generation_nonnegative check (generation >= 0),
  constraint guardian_escalations_status_check check (status in (
    'waiting_for_responses', 'safety_window', 'stopped_negative',
    'frozen_no_majority', 'cancelled_owner_check_in'
  )),
  constraint guardian_escalations_closed_at_check check (
    (status in ('waiting_for_responses', 'safety_window') and closed_at is null)
    or
    (status in ('stopped_negative', 'frozen_no_majority', 'cancelled_owner_check_in')
      and closed_at is not null)
  ),
  constraint guardian_escalations_owner_check_in_check check (
    (status in ('waiting_for_responses', 'safety_window') and owner_checked_in_at is null)
    or status in ('stopped_negative', 'frozen_no_majority')
    or (status = 'cancelled_owner_check_in' and owner_checked_in_at is not null)
  ),
  constraint guardian_escalations_check_in_generation_key unique (check_in_id, generation),
  -- Match the parent owner and preserve the existing account-deletion cascade.
  constraint guardian_escalations_check_in_owner_fkey
    foreign key (check_in_id, user_id) references public.check_ins(id, user_id)
    on update cascade on delete cascade
);

-- Terminal history still reserves its generation; only one cycle may be active.
create unique index guardian_escalations_one_active_per_check_in
  on public.guardian_escalations(check_in_id)
  where status in ('waiting_for_responses', 'safety_window');

-- Match protected server-managed tables: no browser access or policies.
-- Service-role table access does not introduce automatic escalation creation.
alter table public.guardian_escalations enable row level security;
revoke all on public.guardian_escalations from public, anon, authenticated;
grant all on public.guardian_escalations to service_role;

commit;

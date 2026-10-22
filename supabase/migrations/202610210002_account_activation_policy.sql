-- Phase 1 only: read-only eligibility. No triggers, jobs, enforcement or deletion.
-- Applying this migration starts the preparation period for existing accounts.
begin;

create table public.account_activation_policy (
  singleton boolean primary key default true check (singleton),
  activated_at timestamptz not null
);
alter table public.account_activation_policy enable row level security;
revoke all on public.account_activation_policy from public, anon, authenticated;
insert into public.account_activation_policy(singleton, activated_at)
values (true, transaction_timestamp());

create function public.get_account_activation_eligibility()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
  account_id uuid := auth.uid();
  created_at timestamptz;
  activation_at timestamptz;
  starts_at timestamptz;
  evaluated_at timestamptz := transaction_timestamp();
  phase text;
begin
  if account_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select u.created_at into created_at from auth.users u where u.id = account_id;
  if created_at is null then
    raise exception 'Account unavailable' using errcode = '42501';
  end if;

  -- Any active subscription wins, including when multiple records exist.
  if exists (select 1 from public.subscriptions s
             where s.user_id = account_id and s.status = 'active') then
    phase := 'active';
  -- The activation ledger survives subscription status changes. Other records
  -- beyond initial/incomplete checkout are conservatively outside this policy,
  -- including canceled subscriptions and trials. Unknown statuses also fail safe.
  elsif exists (select 1 from public.guardian_plan_activations a where a.user_id = account_id)
     or exists (select 1 from public.subscriptions s where s.user_id = account_id
                and (s.status is null or s.status not in ('incomplete', 'incomplete_expired'))) then
    phase := 'exempt_previous_subscriber';
  else
    select p.activated_at into activation_at from public.account_activation_policy p where p.singleton;
    if activation_at is null then
      raise exception 'Activation policy unavailable';
    end if;
    starts_at := greatest(created_at, activation_at);
    phase := case
      when evaluated_at < starts_at + interval '15 days' then 'preparation'
      when evaluated_at < starts_at + interval '30 days' then 'recovery'
      else 'review_pending'
    end;
  end if;

  -- Review is informational, not a deletion authorization. A future final
  -- notice must be persisted before starting its separate seven-day wait.
  return jsonb_build_object(
    'status', phase,
    'evaluated_at', evaluated_at,
    'starts_at', starts_at,
    'preparation_ends_at', starts_at + interval '15 days',
    'recovery_ends_at', starts_at + interval '30 days'
  );
end;
$$;
revoke all on function public.get_account_activation_eligibility() from public, anon, authenticated;
grant execute on function public.get_account_activation_eligibility() to authenticated;

commit;

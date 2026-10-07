-- UNAPPLIED. Checked against the supplied deployed schema_evidence JSON.
-- Existing check_ins history, constraints, RPCs and UPDATE triggers are preserved.
-- guardians fields are nullable; subscriptions.stripe_subscription_id is UNIQUE.
-- No invitation/response/vote/release schema. Existing guardian.status is unused.
begin;

-- Existing rows receive false only for this NEW bookkeeping field. No existing
-- Check-in history/state column is updated. Only future unpaid INSERTs opt in.
alter table public.check_ins
  add column awaiting_plan_activation boolean not null default false;

create table public.guardian_plan_activations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_subscription_id text not null,
  activated_at timestamptz,
  legacy boolean not null default false,
  check (legacy or activated_at is not null)
);
create table public.guardian_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  guardian_id uuid references public.guardians(id) on delete set null,
  email text,
  status text not null default 'queued' check (status in ('queued','sending','sent','uncertain','cancelled','legacy_suppressed')),
  attempted_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  check (email is not null or status = 'legacy_suppressed'),
  unique (user_id, guardian_id),
  unique (user_id, email)
);
alter table public.guardian_plan_activations enable row level security;
alter table public.guardian_notifications enable row level security;
revoke all on public.guardian_plan_activations, public.guardian_notifications from public, anon, authenticated;
grant all on public.guardian_plan_activations, public.guardian_notifications to service_role;

-- Preserve existing paid users' schedules. Their historic activation timestamp
-- is unknown: explicitly mark legacy instead of inventing a payment date.
-- Suppress bulk retroactive emails; only newly added Guardians are notified.
insert into public.guardian_plan_activations(user_id, stripe_subscription_id, legacy)
select distinct on (user_id) user_id, stripe_subscription_id, true
from public.subscriptions where status = 'active'
order by user_id, current_period_start desc nulls last;
insert into public.guardian_notifications(user_id, guardian_id, email, status)
select g.user_id, g.id, null::text, 'legacy_suppressed'
from public.guardians g
where g.user_id is not null on conflict do nothing;
-- Suppress every legacy identity, including inactive owners and duplicate/null
-- emails. NULL avoids email-uniqueness conflicts dropping a suppression record.
-- The ledger is independent of activation; queueing still requires an active plan.

-- Browser write grants must not bypass owner checks, duplicate protection or
-- fabricate paid subscription state. Preserve existing SELECT grants and RLS.
revoke insert, update, delete, truncate, references, trigger on public.guardians, public.subscriptions from public, anon, authenticated;
do $$
declare col record;
begin
  for col in select c.relname, a.attname from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    where a.attrelid in ('public.guardians'::regclass, 'public.subscriptions'::regclass)
      and a.attnum > 0 and not a.attisdropped
  loop
    execute format('revoke insert (%I), update (%I), references (%I) on public.%I from public, anon, authenticated', col.attname, col.attname, col.attname, col.relname);
  end loop;
  if exists (select 1 from public.check_ins group by user_id having count(*) > 1) then
    raise exception 'Duplicate check_ins owners require review before applying';
  end if;
end;
$$;

create function public.queue_guardian_notifications(p_user_id uuid, p_guardian_ids uuid[])
returns void language sql security definer set search_path = '' as $$
  insert into public.guardian_notifications(user_id, guardian_id, email)
  select g.user_id, g.id, lower(btrim(g.email)) from public.guardians g
  join public.guardian_plan_activations a on a.user_id = g.user_id
  where g.user_id = p_user_id and (p_guardian_ids is null or g.id = any(p_guardian_ids))
    and g.email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    and exists (select 1 from public.subscriptions s where s.user_id = p_user_id and s.status = 'active')
  on conflict do nothing;
$$;

create function public.save_guardian_selection(p_user_id uuid, p_existing_ids uuid[], p_guardians jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  saved public.guardians%rowtype;
  current_ids uuid[];
  expected_ids uuid[];
  retained uuid[] := '{}'::uuid[];
  added uuid[] := '{}'::uuid[];
  emails text[] := '{}'::text[];
  email_value text;
  guardian_id uuid;
  result jsonb := '[]'::jsonb;
  active_plan boolean;
begin
  if p_user_id is null or p_existing_ids is null or p_guardians is null or jsonb_typeof(p_guardians) <> 'array' then raise exception 'Invalid request'; end if;
  if jsonb_array_length(p_guardians) not between 2 and 6 then raise exception 'Choose 2–6 Guardians'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  perform id from public.guardians where user_id = p_user_id order by id for update;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into current_ids from public.guardians where user_id = p_user_id;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into expected_ids from unnest(p_existing_ids) as ids(id);
  if current_ids is distinct from expected_ids then raise exception 'Guardian list changed; reload'; end if;
  for item in select value from jsonb_array_elements(p_guardians)
  loop
    if jsonb_typeof(item) <> 'object' or nullif(btrim(item->>'name'), '') is null
      or nullif(btrim(item->>'relationship'), '') is null or nullif(btrim(item->>'email'), '') is null
      or length(item->>'name') > 254 or length(item->>'relationship') > 254 or length(item->>'email') > 254 then raise exception 'Invalid Guardian'; end if;
    email_value := lower(btrim(item->>'email'));
    if email_value !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or email_value = any(emails) then raise exception 'Invalid or duplicate email'; end if;
    emails := array_append(emails, email_value);
    guardian_id := (item->>'id')::uuid;
    if guardian_id is not null then
      if guardian_id = any(retained) then raise exception 'Duplicate Guardian'; end if;
      update public.guardians set name = btrim(item->>'name'), email = email_value, relationship = btrim(item->>'relationship')
        where id = guardian_id and user_id = p_user_id returning * into saved;
      if not found then raise exception 'Guardian not owned'; end if;
    else
      insert into public.guardians(user_id, name, email, relationship)
        values(p_user_id, btrim(item->>'name'), email_value, btrim(item->>'relationship')) returning * into saved;
      added := array_append(added, saved.id);
    end if;
    retained := array_append(retained, saved.id);
    result := result || jsonb_build_array(jsonb_build_object('id',saved.id,'name',saved.name,'email',saved.email,'relationship',saved.relationship));
  end loop;
  delete from public.guardians where user_id = p_user_id and not (id = any(retained));
  perform public.queue_guardian_notifications(p_user_id, added);
  select exists (select 1 from public.guardian_plan_activations a join public.subscriptions s on s.user_id = a.user_id
    where a.user_id = p_user_id and s.status = 'active') into active_plan;
  return jsonb_build_object('guardians',result,'active',active_plan);
end;
$$;

-- Only NEW configurations participate. Existing RPC updates and the deployed
-- enqueue_continuity_check_in_request AFTER UPDATE trigger remain untouched.
create function public.guard_check_in_activation() returns trigger
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare activation public.guardian_plan_activations%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
  new.awaiting_plan_activation := false;
  select * into activation from public.guardian_plan_activations where user_id = new.user_id;
  if not found then
    new.enabled := false;
    new.awaiting_plan_activation := true;
    -- Keep the provisional next_check_in_at supplied by the deployed save RPC:
    -- check_ins_engine_state_check requires it even when enabled=false.
    -- The deployed engine excludes disabled rows, so no countdown runs yet.
  elsif not activation.legacy then
    if new.frequency_days is null or new.frequency_days < 1 then raise exception 'Invalid check-in frequency'; end if;
    new.enabled := true;
    new.next_check_in_at := activation.activated_at + make_interval(days => new.frequency_days);
  end if;
  return new;
end;
$$;
create trigger guard_check_in_activation before insert on public.check_ins
for each row execute function public.guard_check_in_activation();

-- Trusted, signature-verified webhook only. Payment timestamp comes from Stripe.
create function public.sync_guardian_plan_subscription(p_subscription jsonb, p_activated_at timestamptz)
returns void language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare sub public.subscriptions%rowtype; created integer;
begin
  select * into sub from jsonb_populate_record(null::public.subscriptions, p_subscription);
  if sub.user_id is null or nullif(sub.stripe_subscription_id, '') is null then raise exception 'Invalid subscription'; end if;
  if p_activated_at is not null and (sub.status <> 'active' or p_activated_at > clock_timestamp() + interval '5 minutes') then raise exception 'Invalid activation'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(sub.user_id::text, 0));
  if exists (select 1 from public.subscriptions where stripe_subscription_id = sub.stripe_subscription_id and user_id <> sub.user_id) then raise exception 'Subscription owner mismatch'; end if;
  insert into public.subscriptions(user_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,status,
    current_period_start,current_period_end,cancel_at_period_end,canceled_at,updated_at)
  values(sub.user_id,sub.stripe_customer_id,sub.stripe_subscription_id,sub.stripe_price_id,sub.status,
    sub.current_period_start,sub.current_period_end,sub.cancel_at_period_end,sub.canceled_at,sub.updated_at)
  on conflict(stripe_subscription_id) do update set stripe_customer_id = excluded.stripe_customer_id,
    stripe_price_id = excluded.stripe_price_id, status = excluded.status, current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
    canceled_at = excluded.canceled_at, updated_at = excluded.updated_at;
  if p_activated_at is not null then
    insert into public.guardian_plan_activations(user_id,stripe_subscription_id,activated_at)
      values(sub.user_id,sub.stripe_subscription_id,p_activated_at) on conflict(user_id) do nothing;
    get diagnostics created = row_count;
    if created = 1 then
      -- Only a future unpaid configuration explicitly marked by our INSERT
      -- trigger can start here. Historical rows always have the default false.
      -- Do not assign status, missed_count, last_check_in_at or response_deadline_at.
      update public.check_ins set enabled = true, awaiting_plan_activation = false,
        next_check_in_at = p_activated_at + make_interval(days => frequency_days)
        where user_id = sub.user_id and awaiting_plan_activation = true
          and enabled = false and status = 'scheduled' and missed_count = 0
          and response_deadline_at is null;
      perform public.queue_guardian_notifications(sub.user_id, null);
    end if;
  end if;
end;
$$;

-- One durable provider attempt per notification. Never reclaim sending/uncertain
-- rows automatically, even after the provider's idempotency retention expires.
create function public.claim_guardian_notifications(p_user_id uuid)
returns setof public.guardian_notifications language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  update public.guardian_notifications n set status = 'cancelled' where n.user_id = p_user_id and n.status = 'queued'
    and not exists (select 1 from public.guardians g where g.id = n.guardian_id and g.user_id = n.user_id and lower(btrim(g.email)) = n.email);
  return query with selected as (
    select n.id from public.guardian_notifications n
    where n.user_id = p_user_id and n.status = 'queued'
      and exists (select 1 from public.subscriptions s where s.user_id = p_user_id and s.status = 'active')
    order by n.id limit 6 for update skip locked
  ) update public.guardian_notifications n set status = 'sending', attempted_at = clock_timestamp()
    from selected where n.id = selected.id and n.status = 'queued' returning n.*;
end;
$$;

revoke all on function public.queue_guardian_notifications(uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.save_guardian_selection(uuid,uuid[],jsonb) from public,anon,authenticated;
revoke all on function public.sync_guardian_plan_subscription(jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_guardian_notifications(uuid) from public,anon,authenticated;
revoke all on function public.guard_check_in_activation() from public,anon,authenticated;
grant execute on function public.queue_guardian_notifications(uuid,uuid[]) to service_role;
grant execute on function public.save_guardian_selection(uuid,uuid[],jsonb) to service_role;
grant execute on function public.sync_guardian_plan_subscription(jsonb,timestamptz) to service_role;
grant execute on function public.claim_guardian_notifications(uuid) to service_role;
commit;

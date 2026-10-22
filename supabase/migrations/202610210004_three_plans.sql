-- Three plans. Apply only after review. No Stripe changes or email sends.
begin;
create table public.founder_settings (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false
);
insert into public.founder_settings(singleton) values(true);
create table public.founder_reservations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 slot integer not null check(slot between 1 and 2000),
 state text not null default 'held' check(state in ('held','granted','released')),
 price_id text not null check(length(price_id)>0), site_url text not null,
 session_id text unique, created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '2 hours',
 unique(id,user_id)
);
create unique index founder_occupied_slot on public.founder_reservations(slot) where state <> 'released';
create unique index founder_one_owner on public.founder_reservations(user_id) where state <> 'released';
create table public.lifetime_access (
 user_id uuid primary key references auth.users(id),
 reservation_id uuid not null unique, payment_intent_id text not null unique,
 session_id text not null unique, activated_at timestamptz not null default clock_timestamp(),
 foreign key(reservation_id,user_id) references public.founder_reservations(id,user_id),
 unique(user_id,payment_intent_id)
);
create table public.plan_payment_events (
 event_id text primary key, subject_id text not null, user_id uuid not null references auth.users(id),
 kind text not null check(kind in ('subscription','lifetime_paid','lifetime_expired')),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table public.founder_settings enable row level security;
alter table public.founder_reservations enable row level security;
alter table public.lifetime_access enable row level security;
alter table public.plan_payment_events enable row level security;
revoke all on public.founder_settings,public.founder_reservations,public.lifetime_access,public.plan_payment_events from public,anon,authenticated,service_role;
-- Settings are an explicit deployment gate. No end-user may open sales.
grant select,update on public.founder_settings to service_role;

-- Existing subscription markers remain valid, Lifetime markers require an
-- actual immutable entitlement. Never put a synthetic subscription ID here.
alter table public.guardian_plan_activations alter column stripe_subscription_id drop not null;
alter table public.guardian_plan_activations add column lifetime_payment_intent_id text;
alter table public.guardian_plan_activations add constraint guardian_activation_source check (
 (stripe_subscription_id is not null and lifetime_payment_intent_id is null)
 or (stripe_subscription_id is null and lifetime_payment_intent_id is not null and not legacy and activated_at is not null)
);
alter table public.guardian_plan_activations add constraint guardian_lifetime_payment
 foreign key(user_id,lifetime_payment_intent_id) references public.lifetime_access(user_id,payment_intent_id);

create function public.has_paid_plan(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.subscriptions where user_id=p_user_id and status='active')
 or exists(select 1 from public.lifetime_access where user_id=p_user_id);
$$;
revoke all on function public.has_paid_plan(uuid) from public,anon,authenticated;
grant execute on function public.has_paid_plan(uuid) to service_role;
create function public.has_lifetime_access() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.lifetime_access where user_id=auth.uid());
$$;
revoke all on function public.has_lifetime_access() from public,anon;
grant execute on function public.has_lifetime_access() to authenticated;

create function public.founder_sales_available() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from public.founder_settings where singleton),false)
 and (select count(*) from public.founder_reservations where state<>'released')<2000;
$$;
revoke all on function public.founder_sales_available() from public,anon,authenticated;
grant execute on function public.founder_sales_available() to service_role;

create function public.reserve_founder_slot(p_user_id uuid,p_price_id text,p_site_url text)
returns public.founder_reservations language plpgsql security definer set search_path='' as $$
declare r public.founder_reservations%rowtype; n integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(2000,9999);
 select * into r from public.founder_reservations where user_id=p_user_id and state<>'released';
 if found then return r; end if;
 if not coalesce((select enabled from public.founder_settings where singleton),false) then raise exception 'Founders unavailable'; end if;
 select candidate into n from generate_series(1,2000) candidate
 where not exists(select 1 from public.founder_reservations where slot=candidate and state<>'released') order by candidate limit 1;
 if n is null then raise exception 'Founders sold out'; end if;
 insert into public.founder_reservations(user_id,slot,price_id,site_url) values(p_user_id,n,p_price_id,p_site_url) returning * into r;
 return r;
end $$;
create function public.get_founder_reservation(p_reservation_id uuid)
returns public.founder_reservations language sql stable security definer set search_path='' as $$
 select * from public.founder_reservations where id=p_reservation_id;
$$;
create function public.bind_founder_session(p_reservation_id uuid,p_session_id text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.founder_reservations%rowtype;
begin
 select * into strict r from public.founder_reservations where id=p_reservation_id for update;
 if nullif(p_session_id,'') is null or (r.session_id is not null and r.session_id<>p_session_id) then raise exception 'Session mismatch'; end if;
 update public.founder_reservations set session_id=p_session_id where id=r.id;
end $$;
create function public.record_plan_payment_event(p_event_id text,p_subject_id text,p_user_id uuid,p_kind text)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into public.plan_payment_events(event_id,subject_id,user_id,kind) values(p_event_id,p_subject_id,p_user_id,p_kind) on conflict(event_id) do nothing;
 if not exists(select 1 from public.plan_payment_events where event_id=p_event_id and subject_id=p_subject_id and user_id=p_user_id and kind=p_kind) then raise exception 'Payment event identity mismatch'; end if;
end $$;
create function public.release_founder_slot(p_reservation_id uuid,p_session_id text,p_event_id text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.founder_reservations%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(2000,9999);
 select * into strict r from public.founder_reservations where id=p_reservation_id for update;
 perform public.bind_founder_session(r.id,p_session_id);
 if r.state='granted' then return; end if;
 -- Only the signature-verified handler may call after retrieving expired/unpaid
 -- Stripe state. Local expires_at alone NEVER releases a reservation.
 update public.founder_reservations set state='released' where id=r.id;
 perform public.record_plan_payment_event(p_event_id,p_session_id,r.user_id,'lifetime_expired');
end $$;
create function public.activate_founder_payment(p_reservation_id uuid,p_session_id text,p_payment_intent text,p_event_id text)
returns void language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare r public.founder_reservations%rowtype; activation_time timestamptz; inserted integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(2000,9999);
 select * into strict r from public.founder_reservations where id=p_reservation_id for update;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.user_id::text,0));
 if r.state='released' then raise exception 'Released reservation cannot activate'; end if;
 if nullif(p_payment_intent,'') is null then raise exception 'Missing payment'; end if;
 perform public.bind_founder_session(r.id,p_session_id);
 insert into public.lifetime_access(user_id,reservation_id,payment_intent_id,session_id)
 values(r.user_id,r.id,p_payment_intent,p_session_id) on conflict(user_id) do nothing;
 select activated_at into activation_time from public.lifetime_access
 where user_id=r.user_id and reservation_id=r.id and payment_intent_id=p_payment_intent and session_id=p_session_id;
 if activation_time is null then raise exception 'Lifetime identity mismatch'; end if;
 update public.founder_reservations set state='granted' where id=r.id;
 insert into public.guardian_plan_activations(user_id,stripe_subscription_id,lifetime_payment_intent_id,activated_at)
 values(r.user_id,null,p_payment_intent,activation_time) on conflict(user_id) do nothing;
 get diagnostics inserted = row_count;
 if inserted=1 then
   -- Same guarded initial activation as existing subscriptions. No schedule
   -- reset for an already-activated owner, no change to escalation states.
   update public.check_ins set enabled=true,awaiting_plan_activation=false,
     next_check_in_at=activation_time+make_interval(days=>frequency_days)
   where user_id=r.user_id and awaiting_plan_activation=true and enabled=false
     and status='scheduled' and missed_count=0 and response_deadline_at is null;
 end if;
 -- Existing queue deduplicates identities and retains all sending/sent history.
 perform public.queue_guardian_notifications(r.user_id,null);
 perform public.record_plan_payment_event(p_event_id,p_session_id,r.user_id,'lifetime_paid');
end $$;
revoke all on function public.reserve_founder_slot(uuid,text,text),public.get_founder_reservation(uuid),public.bind_founder_session(uuid,text),public.record_plan_payment_event(text,text,uuid,text),public.release_founder_slot(uuid,text,text),public.activate_founder_payment(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_founder_slot(uuid,text,text),public.get_founder_reservation(uuid),public.bind_founder_session(uuid,text),public.record_plan_payment_event(text,text,uuid,text),public.release_founder_slot(uuid,text,text),public.activate_founder_payment(uuid,text,text,text) to service_role;

-- Only the paid predicate changes in existing Guardian queue/save/claim functions.
create or replace function public.queue_guardian_notifications(p_user_id uuid, p_guardian_ids uuid[])
returns void language sql security definer set search_path = '' as $$
  insert into public.guardian_notifications(user_id, guardian_id, email)
  select g.user_id, g.id, lower(btrim(g.email)) from public.guardians g
  join public.guardian_plan_activations a on a.user_id = g.user_id
  where g.user_id = p_user_id and (p_guardian_ids is null or g.id = any(p_guardian_ids))
    -- Explicit save candidates are new identities or changed email addresses.
    -- Activation-wide queueing must still suppress every legacy identity.
    and (p_guardian_ids is not null or not exists (
      select 1 from public.guardian_notifications n
      where n.user_id = g.user_id and n.guardian_id = g.id
        and n.status = 'legacy_suppressed'
    ))
    and g.email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    and public.has_paid_plan(p_user_id)
  on conflict do nothing;
$$;

create or replace function public.save_guardian_selection(p_user_id uuid, p_existing_ids uuid[], p_guardians jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  saved public.guardians%rowtype;
  current_ids uuid[];
  expected_ids uuid[];
  retained uuid[] := '{}'::uuid[];
  notification_ids uuid[] := '{}'::uuid[];
  previous_email text;
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
      select lower(btrim(email)) into previous_email from public.guardians
        where id = guardian_id and user_id = p_user_id;
      if not found then raise exception 'Guardian not owned'; end if;
      if previous_email is distinct from email_value then
        notification_ids := array_append(notification_ids, guardian_id);
      end if;
      update public.guardians set name = btrim(item->>'name'), email = email_value, relationship = btrim(item->>'relationship')
        where id = guardian_id and user_id = p_user_id returning * into saved;
      if not found then raise exception 'Guardian not owned'; end if;
    else
      insert into public.guardians(user_id, name, email, relationship)
        values(p_user_id, btrim(item->>'name'), email_value, btrim(item->>'relationship')) returning * into saved;
      notification_ids := array_append(notification_ids, saved.id);
    end if;
    retained := array_append(retained, saved.id);
    result := result || jsonb_build_array(jsonb_build_object('id',saved.id,'name',saved.name,'email',saved.email,'relationship',saved.relationship));
  end loop;
  delete from public.guardians where user_id = p_user_id and not (id = any(retained));
  perform public.queue_guardian_notifications(p_user_id, notification_ids);
  select exists (select 1 from public.guardian_plan_activations a
    where a.user_id = p_user_id and public.has_paid_plan(p_user_id)) into active_plan;
  return jsonb_build_object('guardians',result,'active',active_plan);
end;
$$;

create or replace function public.claim_guardian_notifications(p_user_id uuid)
returns setof public.guardian_notifications language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  update public.guardian_notifications n set status = 'cancelled' where n.user_id = p_user_id and n.status = 'queued'
    and not exists (select 1 from public.guardians g where g.id = n.guardian_id and g.user_id = n.user_id and lower(btrim(g.email)) = n.email);
  return query with selected as (
    select n.id from public.guardian_notifications n
    where n.user_id = p_user_id and n.status = 'queued'
      and public.has_paid_plan(p_user_id)
    order by n.id limit 6 for update skip locked
  ) update public.guardian_notifications n set status = 'sending', attempted_at = clock_timestamp()
    from selected where n.id = selected.id and n.status = 'queued' returning n.*;
end;
$$;


-- Original policy dates, exemptions and boundaries are unchanged.
create or replace function public.get_account_activation_eligibility()
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
  if public.has_paid_plan(account_id) then
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
    'access_kind', case when exists(select 1 from public.lifetime_access where user_id=account_id) then 'lifetime' else 'subscription' end,
    'evaluated_at', evaluated_at,
    'starts_at', starts_at,
    'preparation_ends_at', starts_at + interval '15 days',
    'recovery_ends_at', starts_at + interval '30 days'
  );
end;
$$;

commit;

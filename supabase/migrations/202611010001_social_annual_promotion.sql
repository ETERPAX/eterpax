-- Disabled until expiry policy is explicitly approved. No emails, Stripe writes,
-- message writes, cron jobs or existing continuity-cycle resets.
begin;
create table public.promotion_campaign (
 id text primary key check(id='social-annual-2026'),
 enabled boolean not null default false,
 expiry_policy text check(expiry_policy='retain_data_and_continuity'),
 check(not enabled or expiry_policy is not null)
);
insert into public.promotion_campaign(id) values('social-annual-2026');
create table public.promotion_codes (
 campaign_id text not null references public.promotion_campaign(id),
 platform text not null check(platform in ('instagram','facebook')),
 slot integer not null check(slot between 1 and 10),
 digest text not null unique check(digest ~ '^[0-9a-f]{64}$'),
 primary key(campaign_id,platform,slot)
);
create table public.promotional_access (
 user_id uuid primary key references auth.users(id),
 code_digest text not null unique references public.promotion_codes(digest),
 redeemed_at timestamptz not null,
 starts_at timestamptz not null,
 expires_at timestamptz not null,
 check(isfinite(starts_at) and starts_at=redeemed_at
   and expires_at=((starts_at at time zone 'UTC')+interval '12 months') at time zone 'UTC'),
 unique(user_id,code_digest)
);
create table public.promotion_attempts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 window_started_at timestamptz not null,
 attempts integer not null check(attempts between 1 and 5)
);
alter table public.promotion_campaign enable row level security;
alter table public.promotion_codes enable row level security;
alter table public.promotional_access enable row level security;
alter table public.promotion_attempts enable row level security;
revoke all on public.promotion_campaign,public.promotion_codes,public.promotional_access,public.promotion_attempts from public,anon,authenticated,service_role;
-- Service may inspect the deployment gate, but cannot edit codes or benefits.
grant select,update on public.promotion_campaign to service_role;

alter table public.guardian_plan_activations add column promotion_code_digest text;
alter table public.guardian_plan_activations drop constraint guardian_activation_source;
alter table public.guardian_plan_activations add constraint guardian_activation_source check (
 (stripe_subscription_id is not null and lifetime_payment_intent_id is null and promotion_code_digest is null)
 or (stripe_subscription_id is null and lifetime_payment_intent_id is not null and promotion_code_digest is null and not legacy and activated_at is not null)
 or (stripe_subscription_id is null and lifetime_payment_intent_id is null and promotion_code_digest is not null and not legacy and activated_at is not null)
);
alter table public.guardian_plan_activations add constraint guardian_promotion_source
 foreign key(user_id,promotion_code_digest) references public.promotional_access(user_id,code_digest);

create function public.has_plan_access(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.has_paid_plan(p_user_id) or exists (
 select 1 from public.promotional_access where user_id=p_user_id
 and starts_at<=transaction_timestamp() and expires_at>transaction_timestamp());
$$;
revoke all on function public.has_plan_access(uuid) from public,anon,authenticated;
grant execute on function public.has_plan_access(uuid) to service_role;

-- Exact, immutable inventory: a retry must contain the SAME hashes and slots.
-- It cannot add another campaign or another set of twenty codes.
create function public.install_social_promotion(p_codes jsonb) returns text
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.promotion_campaign where id='social-annual-2026' for update;
 if jsonb_typeof(p_codes) is distinct from 'array' or jsonb_array_length(p_codes)<>20 then raise exception 'Expected twenty hashes'; end if;
 if exists(select 1 from jsonb_to_recordset(p_codes) as x(platform text,slot integer,digest text)
   where platform is null or platform not in ('instagram','facebook') or slot is null or slot not between 1 and 10 or digest is null or digest !~ '^[0-9a-f]{64}$')
 or (select count(distinct(platform,slot)) from jsonb_to_recordset(p_codes) as x(platform text,slot integer,digest text))<>20
 or (select count(distinct digest) from jsonb_to_recordset(p_codes) as x(platform text,slot integer,digest text))<>20 then raise exception 'Invalid inventory'; end if;
 if exists(select 1 from public.promotion_codes) then
   if (select count(*) from public.promotion_codes)<>20 or exists (
    select 1 from jsonb_to_recordset(p_codes) as x(platform text,slot integer,digest text)
    where not exists(select 1 from public.promotion_codes c where c.platform=x.platform and c.slot=x.slot and c.digest=x.digest)
   ) then raise exception 'Inventory already installed with different hashes'; end if;
   return 'already_installed';
 end if;
 insert into public.promotion_codes(campaign_id,platform,slot,digest)
 select 'social-annual-2026',platform,slot,digest from jsonb_to_recordset(p_codes) as x(platform text,slot integer,digest text);
 return 'installed';
end $$;
revoke all on function public.install_social_promotion(jsonb) from public,anon,authenticated;
grant execute on function public.install_social_promotion(jsonb) to service_role;

create function public.redeem_social_promotion(p_user_id uuid,p_digest text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare v_now timestamptz; a public.promotion_attempts%rowtype; c public.promotion_codes%rowtype; inserted integer;
begin
 -- Same owner lock as Stripe activation and Guardian configuration.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
 if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then
   return jsonb_build_object('status','ineligible');
 end if;
 v_now:=clock_timestamp();
 select * into a from public.promotion_attempts where user_id=p_user_id;
 if found and a.window_started_at>v_now-interval '15 minutes' and a.attempts>=5 then
   return jsonb_build_object('status','rate_limited');
 end if;
 insert into public.promotion_attempts(user_id,window_started_at,attempts) values(p_user_id,v_now,1)
 on conflict(user_id) do update set
 window_started_at=case when a.window_started_at<=v_now-interval '15 minutes' then v_now else a.window_started_at end,
 attempts=case when a.window_started_at<=v_now-interval '15 minutes' then 1 else a.attempts+1 end;
 if not exists(select 1 from public.promotion_campaign where enabled and expiry_policy is not null) then
   return jsonb_build_object('status','unavailable');
 end if;
 if exists(select 1 from public.promotional_access where user_id=p_user_id) or public.has_paid_plan(p_user_id)
 or exists(select 1 from public.subscriptions where user_id=p_user_id and (status is null or status not in ('canceled','incomplete_expired'))) then
   return jsonb_build_object('status','ineligible');
 end if;
 select * into c from public.promotion_codes where digest=p_digest for update;
 if not found then return jsonb_build_object('status','invalid'); end if;
 if exists(select 1 from public.promotional_access where code_digest=p_digest) then
   return jsonb_build_object('status','used');
 end if;
 v_now:=clock_timestamp();
 insert into public.promotional_access(user_id,code_digest,redeemed_at,starts_at,expires_at)
 values(p_user_id,p_digest,v_now,v_now,v_now+interval '12 months');
 insert into public.guardian_plan_activations(user_id,promotion_code_digest,activated_at)
 values(p_user_id,p_digest,v_now) on conflict(user_id) do nothing;
 get diagnostics inserted=row_count;
 if inserted=1 then
   -- Start only a never-started configuration. Do not reset a running or paused
   -- historical cycle, missed counts, responses, escalation or last_check_in_at.
   update public.check_ins set enabled=true,awaiting_plan_activation=false,
     next_check_in_at=v_now+make_interval(days=>frequency_days)
   where user_id=p_user_id and awaiting_plan_activation=true and enabled=false
     and status='scheduled' and missed_count=0 and response_deadline_at is null
     and last_check_in_at is null;
 end if;
 -- No Guardian queue, notification sender or delivery RPC is invoked.
 return jsonb_build_object('status','success','starts_at',v_now,'expires_at',v_now+interval '12 months');
end $$;
revoke all on function public.redeem_social_promotion(uuid,text) from public,anon,authenticated;
grant execute on function public.redeem_social_promotion(uuid,text) to service_role;

create function public.get_promotional_access() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('campaign',c.campaign_id,'platform',c.platform,
 'redeemed_at',a.redeemed_at,'starts_at',a.starts_at,'expires_at',a.expires_at,
 'active',a.starts_at<=transaction_timestamp() and a.expires_at>transaction_timestamp())
 from public.promotional_access a join public.promotion_codes c on c.digest=a.code_digest
 where a.user_id=auth.uid();
$$;
revoke all on function public.get_promotional_access() from public,anon;
grant execute on function public.get_promotional_access() to authenticated;

-- Reuse existing Guardian gating without redefining what a PAID plan means.
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
    and public.has_plan_access(p_user_id)
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
    where a.user_id = p_user_id and public.has_plan_access(p_user_id)) into active_plan;
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
      and public.has_plan_access(p_user_id)
    order by n.id limit 6 for update skip locked
  ) update public.guardian_notifications n set status = 'sending', attempted_at = clock_timestamp()
    from selected where n.id = selected.id and n.status = 'queued' returning n.*;
end;
$$;


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
  promo jsonb;
begin
  if account_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select u.created_at into created_at from auth.users u where u.id = account_id;
  if created_at is null then
    raise exception 'Account unavailable' using errcode = '42501';
  end if;

  promo := public.get_promotional_access();
  -- Paid access retains priority; expired promotion is never a paid history.
  if not public.has_paid_plan(account_id) and promo is not null then
    return jsonb_build_object('status',case when (promo->>'active')::boolean then 'active' else 'promotion_expired' end,
      'access_kind','promotion','evaluated_at',evaluated_at,'starts_at',null,
      'preparation_ends_at',null,'recovery_ends_at',null,'promotion',promo);
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


-- New configurations cannot use an expired promotional marker to activate.
-- Preserve the original paid activation behavior and all existing rows.
create or replace function public.guard_check_in_activation() returns trigger
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare activation public.guardian_plan_activations%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,0));
 new.awaiting_plan_activation:=false;
 select * into activation from public.guardian_plan_activations where user_id=new.user_id;
 if not found or (activation.promotion_code_digest is not null and not public.has_plan_access(new.user_id)) then
   new.enabled:=false; new.awaiting_plan_activation:=true;
 elsif not activation.legacy then
   if new.frequency_days is null or new.frequency_days<1 then raise exception 'Invalid check-in frequency'; end if;
   new.enabled:=true;
   new.next_check_in_at:=case when activation.promotion_code_digest is not null then clock_timestamp()
     else activation.activated_at end + make_interval(days=>new.frequency_days);
 end if;
 return new;
end $$;
commit;

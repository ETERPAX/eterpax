-- Follow-up to the already-applied Guardian Confirmation Model migration.
-- Preserve all notification history and legacy suppression records.
-- A Guardian may have more than one historical destination; the existing
-- UNIQUE(user_id, email) remains the durable per-address duplicate guard.
-- No backfill, email sending, activation or Check-in changes.
begin;

alter table public.guardian_notifications
  drop constraint guardian_notifications_user_id_guardian_id_key;

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
    and exists (select 1 from public.subscriptions s where s.user_id = p_user_id and s.status = 'active')
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
  select exists (select 1 from public.guardian_plan_activations a join public.subscriptions s on s.user_id = a.user_id
    where a.user_id = p_user_id and s.status = 'active') into active_plan;
  return jsonb_build_object('guardians',result,'active',active_plan);
end;
$$;

-- CREATE OR REPLACE preserves the existing service-only function grants.
commit;

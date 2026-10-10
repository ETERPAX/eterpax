-- Change 4, increment 1: STRUCTURE ONLY. Not applied by this change.
-- Requires Changes 1-3. No backfill, RPC, trigger, scheduler or provider call.
-- A separate 1:1 round preserves compatibility with historical escalations,
-- including safety_window rows that have no Change 4 timing evidence.
-- All future writers must lock check_ins -> guardian_escalations -> children,
-- recheck generation/status/owner cancellation, then capture the server clock.
begin;

create table public.guardian_verification_rounds (
  escalation_id uuid primary key
    references public.guardian_escalations(id) on delete cascade,
  prepared_at timestamptz not null,
  -- Mandatory finite operational bound, not the seven-day voting deadline.
  -- ARGOS must approve its duration and the escalation outcome on exhaustion.
  -- No default silently invents that policy. Future preparation must supply it.
  dispatch_deadline_at timestamptz not null,
  dispatch_exhausted_at timestamptz,
  -- First confirmed provider acceptance, recorded using the DB server clock.
  -- Future acceptance RPC sets this once; queueing/attempting is not acceptance.
  first_accepted_at timestamptz,
  reminder_due_at timestamptz,
  response_deadline_at timestamptz,
  majority_reached_at timestamptz,
  safety_deadline_at timestamptz,
  check (isfinite(prepared_at) and isfinite(dispatch_deadline_at)
    and dispatch_deadline_at > prepared_at),
  check (dispatch_exhausted_at is null or
    (isfinite(dispatch_exhausted_at) and dispatch_exhausted_at >= prepared_at
      and first_accepted_at is null)),
  constraint guardian_verification_rounds_response_window_check check (
    (first_accepted_at is null and reminder_due_at is null and response_deadline_at is null)
    or (first_accepted_at is not null and reminder_due_at is not null
      and response_deadline_at is not null
      and isfinite(first_accepted_at) and first_accepted_at >= prepared_at
      and reminder_due_at = first_accepted_at + interval '72 hours'
      and response_deadline_at = first_accepted_at + interval '168 hours')
  ),
  constraint guardian_verification_rounds_safety_window_check check (
    (majority_reached_at is null and safety_deadline_at is null)
    or (majority_reached_at is not null and safety_deadline_at is not null
      and first_accepted_at is not null and response_deadline_at is not null
      and isfinite(majority_reached_at)
      and majority_reached_at >= first_accepted_at
      and majority_reached_at < response_deadline_at
      and safety_deadline_at = majority_reached_at + interval '48 hours')
  )
);

create table public.guardian_verification_requests (
  escalation_id uuid not null
    references public.guardian_verification_rounds(escalation_id) on delete cascade,
  source_guardian_id uuid not null,
  created_at timestamptz not null,
  primary key (escalation_id, source_guardian_id),
  foreign key (escalation_id, source_guardian_id)
    references public.guardian_escalation_participants(escalation_id, source_guardian_id)
    on delete cascade,
  check (isfinite(created_at))
  -- Recipient/name come only from the frozen participant, never live guardians.
);

create table public.guardian_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  escalation_id uuid not null,
  source_guardian_id uuid not null,
  -- SHA-256 digest of an independently generated >=256-bit random secret.
  -- Digest length cannot prove entropy: generation belongs to a later increment.
  token_digest bytea not null unique,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  unique (id, escalation_id, source_guardian_id),
  foreign key (escalation_id, source_guardian_id)
    references public.guardian_verification_requests(escalation_id, source_guardian_id)
    on delete cascade,
  check (octet_length(token_digest) = 32),
  check (isfinite(created_at) and isfinite(expires_at) and expires_at > created_at),
  check (consumed_at is null or (isfinite(consumed_at)
    and consumed_at >= created_at and consumed_at < expires_at)),
  check (revoked_at is null or (isfinite(revoked_at) and revoked_at >= created_at)),
  check (consumed_at is null or revoked_at is null)
  -- Future RPC must also enforce the round deadline, active generation and state.
  -- Effective expiry is the earlier of expires_at and the round deadline.
);

-- Time is deliberately absent from this predicate. An expired but unrevoked
-- token must be explicitly revoked before a replacement can be created.
create unique index guardian_verification_tokens_one_open
  on public.guardian_verification_tokens(escalation_id, source_guardian_id)
  where consumed_at is null and revoked_at is null;

-- One logical initial notification and one logical 72-hour reminder per request.
-- Retries reuse this row and its stable provider idempotency identity (id).
-- No token, URL, email body, private owner content or raw provider error is stored.
create table public.guardian_verification_notifications (
  id uuid primary key default gen_random_uuid(),
  escalation_id uuid not null,
  source_guardian_id uuid not null,
  kind text not null check (kind in ('initial', 'reminder')),
  token_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'accepted', 'uncertain', 'failed', 'cancelled')),
  created_at timestamptz not null,
  available_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempted_at timestamptz,
  claim_id uuid,
  lease_expires_at timestamptz,
  accepted_at timestamptz,
  provider_message_id text,
  unique (escalation_id, source_guardian_id, kind),
  foreign key (token_id, escalation_id, source_guardian_id)
    references public.guardian_verification_tokens(id, escalation_id, source_guardian_id)
    on delete cascade,
  check (isfinite(created_at) and isfinite(available_at) and available_at >= created_at),
  check ((attempt_count = 0 and last_attempted_at is null)
    or (attempt_count > 0 and last_attempted_at is not null
      and isfinite(last_attempted_at) and last_attempted_at >= created_at)),
  check ((status = 'sending' and claim_id is not null and lease_expires_at is not null
      and last_attempted_at is not null and isfinite(lease_expires_at)
      and lease_expires_at > last_attempted_at)
    or (status <> 'sending' and claim_id is null and lease_expires_at is null)),
  check ((status = 'accepted' and accepted_at is not null and provider_message_id is not null
      and last_attempted_at is not null and isfinite(accepted_at)
      and accepted_at >= last_attempted_at)
    or (status <> 'accepted' and accepted_at is null and provider_message_id is null)),
  check (provider_message_id is null or
    (provider_message_id = btrim(provider_message_id)
      and length(provider_message_id) between 1 and 254)),
  check (status not in ('sending', 'accepted', 'uncertain') or attempt_count > 0)
  -- Later worker: never reclaim an ambiguous provider attempt as queued blindly.
  -- Network calls occur outside SQL transactions. Finalization checks claim_id.
  -- A reminder is eligible only at/after reminder_due_at, before the deadline,
  -- while waiting, without a response, and with the owner's generation unchanged.
  -- Retry only proven nonacceptance, with bounded attempts/backoff; ambiguous
  -- results require reconciliation. Provider retention/limits need review.
);

create table public.guardian_verification_responses (
  escalation_id uuid not null,
  source_guardian_id uuid not null,
  token_id uuid not null unique,
  decision text not null check (decision in ('positive', 'negative')),
  responded_at timestamptz not null,
  primary key (escalation_id, source_guardian_id),
  foreign key (token_id, escalation_id, source_guardian_id)
    references public.guardian_verification_tokens(id, escalation_id, source_guardian_id)
    on delete cascade,
  check (isfinite(responded_at))
  -- Future RPC atomically consumes the token, inserts the immutable response,
  -- counts ONLY frozen participants and updates the escalation/round.
  -- Q = floor(N/2)+1; positives >= Q -> safety_window immediately.
  -- positives + unanswered < Q, or expiry without Q -> frozen_no_majority.
  -- No negative veto and no new use of stopped_negative.
);

create index guardian_verification_rounds_dispatch_due
  on public.guardian_verification_rounds(dispatch_deadline_at, escalation_id)
  where first_accepted_at is null and dispatch_exhausted_at is null;
create index guardian_verification_rounds_response_due
  on public.guardian_verification_rounds(response_deadline_at, escalation_id)
  where response_deadline_at is not null and majority_reached_at is null;
create index guardian_verification_rounds_reminder_due
  on public.guardian_verification_rounds(reminder_due_at, escalation_id)
  where reminder_due_at is not null and majority_reached_at is null;
create index guardian_verification_notifications_queue
  on public.guardian_verification_notifications(available_at, id) where status = 'queued';
create index guardian_verification_notifications_leases
  on public.guardian_verification_notifications(lease_expires_at, id) where status = 'sending';
create index guardian_verification_notifications_token
  on public.guardian_verification_notifications(token_id, escalation_id, source_guardian_id);

-- No app mutation access until reviewed definer RPCs exist. RLS alone does not
-- constrain service_role. Explicitly remove its default table grants as well.
alter table public.guardian_verification_rounds enable row level security;
alter table public.guardian_verification_requests enable row level security;
alter table public.guardian_verification_tokens enable row level security;
alter table public.guardian_verification_notifications enable row level security;
alter table public.guardian_verification_responses enable row level security;
revoke all on public.guardian_verification_rounds,
  public.guardian_verification_requests, public.guardian_verification_tokens,
  public.guardian_verification_notifications, public.guardian_verification_responses
  from public, anon, authenticated, service_role;
grant select on public.guardian_verification_rounds,
  public.guardian_verification_requests, public.guardian_verification_notifications,
  public.guardian_verification_responses to service_role;
-- Token digests remain inaccessible to service_role directly; future narrow RPCs
-- will validate secrets without exposing the token ledger. No browser policies.

-- Deliberately not enforced by this structural increment:
-- * First acceptance write-once semantics, 2-6 participant completeness, quorum,
--   response/consumption timestamp equality and state transitions need locked RPCs.
-- * Existing confirm_check_in stays unchanged; all future operations must reject
--   cancelled, terminal or stale-generation rounds, even with an unrevoked token.
-- * The dispatch bound needs a worker and an ARGOS-approved exhaustion outcome;
--   storing it alone does not close a round or resolve ambiguous acceptance.
-- * Reminders/retries need reproducible credentials without plaintext storage.
--   Hashes cannot reconstruct links. An external encrypted secret store (or a
--   separately reviewed design) is required before enabling any provider sends.
-- * The safety deadline records 48 hours only; its expiry authorizes no release
--   here. No message delivery or access to private content is introduced.
commit;

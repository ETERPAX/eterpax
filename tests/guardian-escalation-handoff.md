# Change 3 validation runbook — NOT EXECUTED

This document authorizes no connection, migration, fixture or remote action.
Change 3 is local code only until separately approved. No database results are
claimed. CONCURRENCY NOT YET PROVEN.

## Target and application prerequisites

Use a separately authorized, disposable validation environment. Never use real
production accounts or the existing non-disposable TEST account. Record target
project identity independently of database name, operator, reviewed migration
checksum, PostgreSQL version and retained evidence outside the repository.

Capture exact current engine definition, owner, return type, settings and ACL
before application. Compare the earlier transitions to the supplied production
definition. Expected: postgres owner, SECURITY DEFINER, empty search_path, UTC,
server-only execution. Inspect effective role privileges, not merely ACL text.
Unexpected existing function grantees require review: replacement preserves
non-revoked existing ACL entries. Do not silently normalize unrelated grants.

Required baseline: Changes 1 and 2, auth/roles, live Guardians with the established
fields, eterpax_environment, continuity_timing_policy, and the engine's existing
dependencies. Capture full Check-in trigger definitions and external effects.
Do not synchronize unrelated activation/notification architecture. Absence of
those paths limits regression claims. Confirm new table/name absence and inspect
existing escalation rows before applying new constraints. Verify the migration
operator's postgres ownership/DDL authority and default privileges.

The preserved engine rejects any environment other than 'production'. A normal
TEST environment therefore must reject invocation with 42501. Do not relabel a
shared TEST environment or bypass the guard casually. Full engine behavioral
testing requires separate explicit authorization for a disposable, isolated
fixture environment with the engine's required environment/timing rows and no
live scheduler, delivery workers or external effects. A local mocked algorithm
does not establish that the installed engine works. If such a target is not
authorized, record behavioral validation as BLOCKED; static tests still run.

Record pre-application table contents, constraints, indexes, RLS, policies, table
and column ACLs, and existing function definitions. Use a quiet window for exact
comparisons. No secret or real-user identifiers belong in repository evidence.

Only after separate approval, apply exactly:
`supabase/migrations/202610080002_guardian_escalation_handoff.sql`.
It has BEGIN/COMMIT. Use an error-stopping compatible runner. STOP on errors or
uncertain commit; inspect outcome before retry. Do not apply Changes 1/2 again.
Check existing constraints retain their meanings and only blocked terminal status
is added. Check Change 2 function definition remains byte-for-byte unchanged.

## Structural/security inspection

Use pg_attribute, pg_constraint, pg_index, pg_class, pg_policies, pg_proc and
pg_get_functiondef to verify the actual schema and RPC after authorized application:

- Exactly five participant fields; UUID composite PK; normalized email uniqueness.
- Only escalation FK, ON DELETE CASCADE; no live-Guardian FK.
- Names/relationships trimmed, 1–254 characters; normalized valid email.
- Six escalation statuses; blocked requires closed_at; prior five timestamp
  semantics preserved. Existing ownership/generation/active uniqueness unchanged.
- Participant RLS enabled, no policies; PUBLIC/anon/authenticated have no table
  or column access. service_role has SELECT only, no direct mutation privileges.
  Check effective grants including role memberships and default privileges.
- postgres-owned engine retains settings and return signature; PUBLIC, anon and
  authenticated cannot execute; service_role can execute. Validate auth role setup
  separately from SECURITY DEFINER table access.
- No new workflow table, email enqueue, token, response or delivery implementation.

Snapshot immutability applies to supported application writes. Postgres and other
privileged administration can bypass application boundaries. Parent/account deletion
cascades can delete snapshot data by design; live Guardian deletion cannot.

## Behavioral cases

Create purpose-built synthetic owners with complete schema-valid Check-ins and
Guardian fixtures only through authorized harness operations. Capture fixture
baseline. Each case uses BEGIN/ROLLBACK; expected errors use SAVEPOINT and rollback
to it before inspection. Fresh-session verification must show new transaction
rows gone and pre-existing fixtures restored. Auth/API or external side effects
do not roll back with SQL; disable external workers and authorize cleanup separately.

Seed awaiting_response, missed_count 2, enabled true, expired response deadline,
next date NULL and a known generation g. Do not disable FK/check constraints.
Invoke the actual engine once; inspect returned transition and persisted data.

### Valid sets

Independently exercise 2, 3 and 6 Guardians. Require:

- Parent pending/count 3, both scheduling dates NULL, generation g unchanged.
- Exactly one waiting cycle at g; closed_at/owner_checked_in_at NULL.
- Exactly N participants with original IDs and trimmed names/relationships and
  lower/trimmed emails. Cycle created_at equals parent updated_at.
- Save later name/email/relationship changes, add/remove Guardians through the
  supported path where its dependencies exist: old snapshot remains identical.
  No source FK may block deletion of a live Guardian or cascade that deletion.
- Repeat engine call: no duplicate, no snapshot rewrite, no generation change.
- Seed older terminal g-1 history: remains unchanged after handoff at g.
- Normal authenticated owner Check-in cancels g, advances to g+1. Drive a later
  legitimate miss-3 cycle with fresh fixtures/timing: creates g+1 only.

### Invalid sets

Independently exercise 0, 1, and >6 Guardians (where schema allows); NULL/blank
required fields; overlength fields; invalid email; case/whitespace-normalized
duplicates. Null/duplicate IDs may be impossible under existing Guardian keys;
record as schema-prevented rather than weakening constraints.

Require pending/count 3, generation unchanged, exactly one blocked cycle,
closed_at = created_at = parent updated_at, owner_checked_in_at NULL, zero
participants. No ordinary invalid set should raise an engine error. Include valid
and invalid owners in the same batch: both reach their appropriate durable outcome.
Correct live Guardians afterward and rerun: blocked generation stays blocked.
Normal owner Check-in rearms and increments; blocked status/closed_at remain
unchanged, acknowledgement remains NULL under unchanged Change 2. The next
legitimate generation can snapshot the corrected set.

### Conflicts and rollback

- Seed an existing current-generation waiting cycle with no snapshot, then with
  a complete snapshot; both on an otherwise eligible pre-handoff parent. Engine
  explicitly rejects anomalous pre-existing identity (23514); neither is rebuilt.
  Complete-existing-cycle reuse is intentionally not implemented or necessary for
  normal reruns, because pending parents are not selected.
- Repeat for terminal/blocked current-generation history; nothing is reopened.
- Different-generation active row must cause active-index failure, not silent skip.
- In a disposable harness only, inject a participant-insert failure using an
  authorized test-only fault mechanism after parent/cycle writes (e.g. a temporary
  test trigger in the rolled-back fixture transaction). Do not edit the migration.
  Verify parent remains awaiting_response/count 2, no new cycle/participants, and
  all earlier changes from that engine invocation roll back. Remove/rollback the
  fault fixture. If no safe harness exists, mark this test NOT PROVEN.
- Successful invocation followed by outer rollback restores full fixture state.
- Unexpected SQL errors abort the batch; only expected invalid configuration
  takes the normal blocked branch. Timeout/disconnect does not prove rollback.

### Regression and side effects

Test scheduled due → awaiting_response, expired miss 0 → scheduled/miss 1,
expired miss 1 → scheduled/miss 2, disabled/not-due rows skipped, and maximum 100
eligible rows per invocation. Check timing calculations and returned columns.
Test missing/invalid timing policy and nonproduction guard fail without changes.
Test normal owner Check-in, active cancellation, generation increment and older
history preservation using the Change 2 runbook. Actual production triggers are
not proven by a fixture environment lacking them.

Inspect pre/post notification/outbox counts attributable to each branch: miss #3
must create no Guardian communication. Earlier scheduled transitions may still
enqueue normal Check-in requests if the existing trigger is present. No delivery
worker should run. Do not equate an absent table with successful workflow testing.

## Independent multi-session acceptance — NOT PROVEN

Use independent DB sessions with deterministic barriers, not sequential statements:

1. Save commits before the handoff's single Guardian SELECT: captures new set.
2. Save is uncommitted at SELECT and commits afterward: captures complete old set.
3. Save rolls back: captured committed set remains coherent.
4. Owner holds parent first: engine skips/revalidates; no stale active cycle.
5. Engine holds parent first: owner waits, then cancels cycle and increments.
6. Concurrent engine calls: SKIP LOCKED/identity uniqueness yield one cycle.
7. First holder rolls back: waiter proceeds from committed baseline.

Never take an owner advisory lock inside the already-parent-locked engine loop.
MVCC snapshot timing determines old versus new selection, not commit order alone.
Never reread editable Guardians to insert the participant snapshot.

## Rollback and evidence gate

Before deployment, failed migration transaction should leave old schema/function
intact; verify rather than assume after disconnect. After application, prefer a
reviewed forward correction. Do not blindly drop participants or remove blocked
status if history exists. Do not restore a handoff-unaware engine while claiming
atomic handoff remains enabled. Any rollback requires separate data/dependency
inspection and authorization; no rollback migration is provided here.

Record separately: static checks passed; structural DB validation; each behavior;
injected-failure rollback; effective security; concurrent sessions; full production
regression. Until executed, database claims remain NOT PROVEN. Passing Change 3
does not authorize verification communications, deadlines, quorum or release.

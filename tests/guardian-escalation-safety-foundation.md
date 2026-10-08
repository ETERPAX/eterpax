# Guardian escalation safety foundation: database validation runbook

## Scope and authorization

This document is an unexecuted procedure, not permission to connect, apply a
migration, create accounts, or run tests. No verified disposable database harness
currently exists in this repository. Obtain explicit ARGOS authorization and
independently verify the environment before each applicable phase. Never print
connection strings, passwords, API keys, or session tokens in evidence.

The subject is **Step 1 / Change 1**, the persistence-only migration:
`supabase/migrations/202610070001_guardian_escalation_safety_foundation.sql`.
It does not modify `confirm_check_in`, advance generations, cancel escalations,
or enable handoff. Passing this runbook cannot prove those future behaviors.

Phases 0, 2, 3, and 5 contain read-only queries. Phase 1 requires separate
migration authorization. Phase 4 is permitted only in a verified disposable
local/isolated database, never production, shared staging, a remote database,
or an existing user database. Do not install tooling or invent a target to bypass
that requirement. A localhost address alone is insufficient: it could be a tunnel.

Record the approved target, isolation/lifecycle evidence, PostgreSQL version,
operator, migration file checksum, and execution time in a protected external
validation record. Do not save live account data or credentials into this repo.

## Phase 0 — Pre-flight / read only

### Target and complete baseline

Run only after connection authorization; compare identity to the approved target.
These values help identify a connection but do not prove disposability.

```sql
SELECT current_database(), current_user, session_user,
       inet_server_addr(), inet_server_port(), version();

SELECT a.attnum, a.attname,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_catalog.pg_attribute AS a
LEFT JOIN pg_catalog.pg_attrdef AS d
  ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'public.check_ins'::regclass
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT c.conname, c.contype, c.convalidated,
       pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
FROM pg_catalog.pg_constraint AS c
WHERE c.conrelid = 'public.check_ins'::regclass
ORDER BY c.conname;

SELECT i.indexrelid::regclass AS index_name,
       i.indisunique, i.indisvalid, i.indisready,
       pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
FROM pg_catalog.pg_index AS i
WHERE i.indrelid = 'public.check_ins'::regclass
ORDER BY i.indexrelid::regclass::text;

SELECT c.relowner::regrole AS owner, c.relrowsecurity,
       c.relforcerowsecurity, c.relacl
FROM pg_catalog.pg_class AS c
WHERE c.oid = 'public.check_ins'::regclass;

SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public' AND tablename = 'check_ins'
ORDER BY policyname;

SELECT a.attname, a.attacl
FROM pg_catalog.pg_attribute AS a
WHERE a.attrelid = 'public.check_ins'::regclass
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT t.tgname, pg_catalog.pg_get_triggerdef(t.oid, true) AS definition
FROM pg_catalog.pg_trigger AS t
WHERE t.tgrelid = 'public.check_ins'::regclass AND NOT t.tgisinternal
ORDER BY t.tgname;
```

Expected columns before migration (no thirteenth column):

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | none |
| frequency_days | integer | No | none |
| enabled | boolean | No | true |
| last_check_in_at | timestamptz | Yes | none |
| next_check_in_at | timestamptz | Yes | none |
| missed_count | integer | No | 0 |
| created_at | timestamptz | No | now() |
| updated_at | timestamptz | No | now() |
| status | text | No | none |
| response_deadline_at | timestamptz | Yes | none |
| awaiting_plan_activation | boolean | No | false |

Compare types/defaults semantically; catalog casts and timestamp type spelling
may differ. Expected original indexes are the valid unique primary key on `id`
and `check_ins_user_id_key` on `user_id`. Expected constraints include positive
frequency, missed count 0–3, those keys, the existing user FK with update/delete
cascade, and the two engine checks. The engine states must remain:

- scheduled: missed count 0–2, next date set, response deadline null;
- awaiting_response: missed count 0–2, next date null, response deadline set;
- escalation_pending: missed count 3, both dates null.

Expected RLS is enabled, not forced; the authenticated SELECT policy restricts
`user_id = auth.uid()`. Supplied table ACL grants authenticated SELECT only,
and postgres/service_role all table privileges. Investigate any column grants
that provide additional access. Expected non-internal triggers are
`enqueue_continuity_check_in_request` and `guard_check_in_activation`.

STOP on missing objects, invalid indexes/constraints, unexpected columns,
permission changes, extra triggers/policies, or any unexplained baseline drift.
Do not repair the target as part of this validation.

### Required roles before migration application

```sql
SELECT rolname
FROM pg_catalog.pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY rolname;
```

Expected: exactly the three required roles, anon, authenticated, and service_role.
If any required role is absent, STOP before applying the migration. Missing roles
are not a passing security condition; do not bypass the privilege statements.

### Confirm the migration is not already installed

```sql
SELECT pg_catalog.to_regclass('public.guardian_escalations') AS escalation_table,
       pg_catalog.to_regclass('public.guardian_escalations_one_active_per_check_in') AS active_index;

SELECT attname
FROM pg_catalog.pg_attribute
WHERE attrelid = 'public.check_ins'::regclass
  AND attname = 'escalation_generation' AND NOT attisdropped;

SELECT conname
FROM pg_catalog.pg_constraint
WHERE conrelid = 'public.check_ins'::regclass
  AND conname IN ('check_ins_escalation_generation_nonnegative', 'check_ins_id_user_id_key');

SELECT pg_catalog.to_regclass('supabase_migrations.schema_migrations') AS history_table;
```

Expected: null new-object names and zero matching column/constraint rows.
If a Supabase migration history table exists with the standard `version` column,
also inspect it read-only:

```sql
SELECT version
FROM supabase_migrations.schema_migrations
WHERE version = '202610070001';
```

Expected: zero rows. If the history table is absent, record that migration history
cannot be checked; object absence remains the structural check. If history
exists but is inaccessible, resolve that evidence gap before proceeding.
Any installed marker or partial installation is a STOP, not permission to rerun.

### Capture existing row contents BEFORE application

Arrange an authorized quiet validation window with no application/cron writers.
Do not claim equality across concurrent legitimate writes. Export the following
ordered result to protected evidence outside the repo, recording row count.

```sql
SELECT id, user_id, frequency_days, enabled, last_check_in_at,
       next_check_in_at, missed_count, created_at, updated_at, status,
       response_deadline_at, awaiting_plan_activation
FROM public.check_ins
ORDER BY id;
```

Use identical client timestamp/session formatting for both captures. Capture the
function/constraint baseline in Phase 5 now, before moving to Phase 1.
If the operator cannot see every row, whole-table data equality is NOT PROVEN.

## Phase 1 — Migration application

Separate explicit authorization is mandatory. Apply only the reviewed file:
`supabase/migrations/202610070001_guardian_escalation_safety_foundation.sql`.
Verify its checksum against the reviewed artifact. This runbook intentionally
does not provide a connection command or remote push command.

The file contains its own BEGIN/COMMIT. Use an error-stopping client and an
approved runner compatible with that transaction. Success means the complete
transaction committed: column, constraints, table, index, RLS, and ACL together.
There are no escalation inserts or Check-in reset UPDATEs in the file.

STOP on any error, timeout, disconnect, unexpected notice requiring intervention,
or uncertain COMMIT acknowledgement. Do not continue with subsequent statements,
rerun blindly, or assume a connection failure implies rollback. An aborted open
transaction must be rolled back through the approved runner. Re-establish outcome
with authorized read-only catalog inspection before any retry is considered.

## Phase 2 — Post-migration structural validation

```sql
SELECT a.attrelid::regclass AS table_name, a.attnum, a.attname,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_catalog.pg_attribute AS a
LEFT JOIN pg_catalog.pg_attrdef AS d
  ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid IN ('public.check_ins'::regclass, 'public.guardian_escalations'::regclass)
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attrelid::regclass::text, a.attnum;

SELECT c.conrelid::regclass AS table_name, c.conname, c.contype,
       c.convalidated, c.confupdtype, c.confdeltype,
       pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
FROM pg_catalog.pg_constraint AS c
WHERE c.conrelid IN ('public.check_ins'::regclass, 'public.guardian_escalations'::regclass)
ORDER BY c.conrelid::regclass::text, c.conname;

SELECT i.indrelid::regclass AS table_name, i.indexrelid::regclass AS index_name,
       i.indisunique, i.indisvalid, i.indisready,
       pg_catalog.pg_get_indexdef(i.indexrelid) AS definition,
       pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate
FROM pg_catalog.pg_index AS i
WHERE i.indrelid IN ('public.check_ins'::regclass, 'public.guardian_escalations'::regclass)
ORDER BY i.indrelid::regclass::text, i.indexrelid::regclass::text;

SELECT relowner::regrole AS owner, relrowsecurity, relforcerowsecurity, relacl
FROM pg_catalog.pg_class
WHERE oid = 'public.guardian_escalations'::regclass;

SELECT policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public' AND tablename = 'guardian_escalations';
```

Expected delta:

- Check-in generation: bigint, NOT NULL, default zero, nonnegative CHECK.
- Supporting unique `(id, user_id)`; original Check-in constraints unchanged.
- Escalation columns exactly: UUID `id` (PK/default random UUID), UUID parent and
  owner NOT NULL, bigint generation NOT NULL, text status NOT NULL, created_at
  timestamptz NOT NULL/default now(), nullable timestamptz closed_at and
  owner_checked_in_at.
- Nonnegative child generation; unique `(check_in_id, generation)`.
- Exactly five status literals: waiting_for_responses, safety_window,
  stopped_negative, frozen_no_majority, cancelled_owner_check_in.
- Active states require both optional timestamps null; negative/frozen require
  closed_at nonnull and permit either owner timestamp; cancelled requires both.
- Composite FK `(check_in_id, user_id)` references Check-in `(id, user_id)`.
  `confupdtype = 'c'` and `confdeltype = 'c'` mean both actions cascade.
- Valid unique partial index on check_in_id restricted to waiting/safety states.
- RLS enabled, no browser policies, no unexpected additional constraints/indexes.

### Effective privileges, including PUBLIC and column grants

```sql
SELECT CASE WHEN x.grantee = 0 THEN 'PUBLIC'
            ELSE pg_catalog.pg_get_userbyid(x.grantee) END AS grantee,
       x.privilege_type, x.is_grantable
FROM pg_catalog.pg_class AS c
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS x
WHERE c.oid = 'public.guardian_escalations'::regclass
ORDER BY grantee, privilege_type;

SELECT rolname, rolsuper, rolbypassrls
FROM pg_catalog.pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role');

SELECT r.rolname, p.privilege,
       pg_catalog.has_table_privilege(r.oid, 'public.guardian_escalations', p.privilege) AS allowed
FROM pg_catalog.pg_roles AS r
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                   ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(privilege)
WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
ORDER BY r.rolname, p.privilege;

SELECT r.rolname, a.attname, p.privilege,
       pg_catalog.has_column_privilege(r.oid, a.attrelid, a.attnum, p.privilege) AS allowed
FROM pg_catalog.pg_roles AS r
CROSS JOIN pg_catalog.pg_attribute AS a
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS p(privilege)
WHERE r.rolname IN ('anon', 'authenticated')
  AND a.attrelid = 'public.guardian_escalations'::regclass
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY r.rolname, a.attnum, p.privilege;
```

Expected: PUBLIC has no ACL entries; anon/authenticated effective permissions are
all false, including columns; service_role table permissions are true. Verify
all three roles actually exist; zero role rows are not a passing permission test.
If a disposable PostgreSQL harness lacks Supabase roles, document security
validation as NOT PROVEN and STOP application unless an approved faithful role
fixture exists. Do not edit the migration to skip its revocations/grants.
RLS bypass is separate from table privilege. Check all ACL entries, including any
version-specific privileges, against the approved server-managed convention.

## Phase 3 — Existing-data safety / read only

```sql
SELECT count(*) AS total_rows,
       count(*) FILTER (WHERE escalation_generation IS DISTINCT FROM 0) AS nonzero_or_null
FROM public.check_ins;

SELECT count(*) AS invalid_rows
FROM public.check_ins
WHERE (frequency_days > 0 AND missed_count BETWEEN 0 AND 3 AND (
  (status = 'scheduled' AND missed_count BETWEEN 0 AND 2
    AND next_check_in_at IS NOT NULL AND response_deadline_at IS NULL)
  OR (status = 'awaiting_response' AND missed_count BETWEEN 0 AND 2
    AND next_check_in_at IS NULL AND response_deadline_at IS NOT NULL)
  OR (status = 'escalation_pending' AND missed_count = 3
    AND next_check_in_at IS NULL AND response_deadline_at IS NULL)
)) IS NOT TRUE;

SELECT count(*) AS escalation_rows FROM public.guardian_escalations;
```

Expected immediately after this migration, before any fixtures: zero nonzero/null
generations, zero invalid rows, zero escalation rows. Re-run the exact 12-column
ordered row query from Phase 0 and compare every field and row identity with the
protected baseline. Identical captures prove those fields remained unchanged
across the observed interval; counts alone do not. Missing baseline, invisible
rows, or concurrent writes mean equality is NOT PROVEN: STOP and investigate.

## Phase 4 — Controlled behavioral tests (unexecuted)

Only a separately authorized disposable local/isolated target may run this phase.
Use purpose-created disposable identities A and B with no real user/content data.
Create them only through the approved harness; do not copy production auth records
or invent an incomplete auth.users fixture. Verify the actual user-to-Check-in
cascade exists. If faithful auth/role fixtures are unavailable, STOP.

For each test below, start a transaction, create a disposable Check-in for A using
the verified harness and a constraint-valid scheduled state, run the test, inspect
the result, then ROLLBACK. Allow the real activation trigger to run: do not disable
triggers, RLS, constraints, or foreign keys. The parent can remain disabled by its
activation gate; this migration does not require an active subscription.

Use explicit fixture IDs, never a query selecting an arbitrary existing account.
For expected failures, establish a SAVEPOINT before the failing statement; verify
the SQLSTATE and applicable constraint as specified below, then ROLLBACK TO that savepoint before further
reads. An error by itself does not establish that the intended invariant failed.
Unexpected success or a different error is a failed test. Always finish with a
full ROLLBACK and verify from a fresh session that records created inside the
transaction disappeared. Disposable fixture records that existed before the
transaction must instead return to their captured pre-test baseline; capture
that baseline before testing. Never use real ETERPAX users or the real owner.

| Test | Transaction-local operation | Required observation |
| --- | --- | --- |
| Parent generation | Set fixture Check-in generation to -1 | 23514, check_ins_escalation_generation_nonnegative; prior value preserved |
| Matching ownership | Insert child using A's Check-in ID and A's user ID, generation 0, waiting status, both optional timestamps null | Insert succeeds |
| Mismatched ownership | Use A's Check-in ID but B's existing disposable user ID | 23503, guardian_escalations_check_in_owner_fkey |
| Child generation | Insert otherwise valid child with generation -1 | 23514, guardian_escalations_generation_nonnegative |
| Generation identity | Insert two terminal children with identical parent/generation, different UUIDs, valid timestamps | Second fails 23505, guardian_escalations_check_in_generation_key; terminal status avoids confounding active index |
| Active uniqueness | Insert waiting child at generation 0, then safety child at generation 1 for same parent | Second fails 23505, guardian_escalations_one_active_per_check_in |
| Terminal history | Insert negative and frozen children at distinct generations with closure timestamps | Both succeed; may coexist with one active child |
| Unknown status | Insert a child with an unapproved status | Must be rejected with SQLSTATE 23514 from an applicable CHECK; do not require one particular CHECK name because the row may violate multiple CHECKs |

Independently verify the exact five authorized statuses through Phase 2 catalog
inspection of guardian_escalations_status_check. The behavioral test still
requires rejection of unauthorized statuses; it does not prescribe which CHECK
PostgreSQL reports first.

### Timestamp matrix

Start with a disposable parent having no escalation rows. For EVERY matrix cell,
establish a SAVEPOINT before the insert, inspect the result, and ROLLBACK TO that
SAVEPOINT after the attempt, including successful inserts. Verify the baseline
is restored before the next cell so no cell can contaminate another. A different
generation alone is not isolation: the active-cycle index spans generations for
the same parent. Finish the enclosing transaction with ROLLBACK.
Attempt every cell with otherwise valid fields. Set timestamp values
explicitly; test nullability rather than assuming chronological checks exist.

| Status | Both NULL | closed set / owner NULL | closed NULL / owner set | Both set |
| --- | --- | --- | --- | --- |
| waiting_for_responses | Accept | Reject | Reject | Reject |
| safety_window | Accept | Reject | Reject | Reject |
| stopped_negative | Reject | Accept | Reject | Accept |
| frozen_no_majority | Reject | Accept | Reject | Accept |
| cancelled_owner_check_in | Reject | Reject | Reject | Accept |

Rejections must be CHECK violations (23514) naming the applicable closure/owner
timestamp constraint. No chronological ordering, response immutability, or valid
state transition enforcement is claimed by these checks.

### Account-deletion cascade

Require a purpose-created disposable account A and an explicit account-deletion
test authorization. Never use the real owner or an existing ETERPAX user.
Inside a transaction, establish A's Check-in and child escalation, verify one of
each exists, delete A's auth.users row through the verified database cascade path,
then verify all three fixture identities are absent. Verify an independent
disposable account B is unaffected. ROLLBACK; records created inside the transaction
must disappear, while any disposable account or other fixture record that existed
before it must return to its captured pre-test baseline. The test must use the real
FKs without weakening or disabling them.

This establishes database FK behavior, not complete Auth API account-deletion
behavior. Auth API account creation/deletion cannot be enrolled in an unrelated
SQL transaction. External hooks, emails, storage operations, and other external
side effects may not roll back. Use an isolated harness with external effects
disabled/absent and a separate authorized cleanup plan; rollback alone is not
a license to test on real accounts.

### Migration transaction failure (only if the harness supports it)

On a separate pristine disposable database with the same pre-migration baseline,
an approved test harness may submit the migration statements through the point
before COMMIT, inject a deliberate error, and roll back. Do not modify the
production migration artifact. Verify absence of the new column, table, supporting
constraint/indexes and ACL changes, and equality of the original baseline.
If the harness cannot safely control the transaction, record migration rollback
atomicity as NOT PROVEN rather than improvise. This is distinct from rolling back
fixture DML on an already-installed schema.

## Phase 5 — Existing function regression / read only

Run this query BEFORE Phase 1 and repeat AFTER. Retain full definitions plus
fingerprints and metadata in protected evidence. MD5 here is a change-detection
fingerprint, not a security signature.

```sql
SELECT p.oid::regprocedure AS signature, p.proowner::regrole AS owner,
       p.prosecdef, p.proconfig, p.proacl,
       pg_catalog.pg_get_functiondef(p.oid) AS definition,
       md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_fingerprint
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND p.proname IN ('process_continuity_engine', 'save_check_in_configuration',
    'confirm_check_in', 'enqueue_continuity_check_in_request', 'guard_check_in_activation')
ORDER BY p.oid::regprocedure::text;

SELECT conname, convalidated,
       pg_catalog.pg_get_constraintdef(oid, true) AS definition,
       md5(pg_catalog.pg_get_constraintdef(oid, true)) AS definition_fingerprint
FROM pg_catalog.pg_constraint
WHERE conrelid = 'public.check_ins'::regclass
  AND conname IN ('check_ins_engine_state_check', 'check_ins_engine_status_check')
ORDER BY conname;
```

Expected signatures: process_continuity_engine(),
save_check_in_configuration(integer), confirm_check_in(),
enqueue_continuity_check_in_request(), guard_check_in_activation(). Unexpected
overloads require review. Both engine constraints must be present and validated.
Compare signatures, complete definitions, checksums, ownership, security mode,
function settings, and ACLs exactly before/after; compare Phase 0 trigger
definitions and original table grants/policies too. STOP on unexplained changes.

Unchanged definitions prove preservation, not successful runtime regression or
future cancellation. This change intentionally leaves confirm_check_in unchanged:
it still does not advance generation or cancel seeded escalation records.
Do not enable handoff merely because these checks pass.

## Phase 6 — Rollback plan (proposal only; no rollback SQL)

- Before commit, a failed migration transaction should roll back as a unit;
  verify rather than assume that outcome after connection loss.
- After commit, prefer a reviewed forward correction. Stop any future creation
  or processing through a separately authorized operational action first.
- Inventory guardian_escalations data, generation values, dependent functions,
  grants, and any later migrations. Preserve backups/audit evidence before action.
- Never blindly drop a populated escalation table or reset/drop generation:
  that may destroy terminal history and allow the same generation to be recreated.
- Only with explicit rollback authorization, verified absence of valuable data,
  and no later dependencies could schema removal be considered. The child table's
  composite FK must be removed before the supporting parent uniqueness; its
  partial index and child constraints belong to that table. The generation CHECK
  and column must be assessed separately for later dependencies.
- Do not use an indiscriminate CASCADE drop. Supporting parent uniqueness cannot
  be removed while a child FK depends on it. Do not touch the original primary
  key, owner uniqueness, state checks, account FK, or existing functions.
- If data or dependencies exist, leave the foundation installed and return to
  ARGOS with a data-preserving correction plan. Restoration of a cancellation-
  unaware function is not a safe rollback of a later enabled workflow.

## Phase 7 — Concurrency

**CONCURRENCY NOT YET PROVEN.**

Sequential inserts prove constraint rejection only. Future tests require genuine
independent database sessions, controlled barriers, and commit/rollback ordering:

- Owner Check-in versus the Continuity Engine: row locking and final schedule.
- Owner Check-in versus future handoff: no active old-generation cycle after reset.
- Duplicate handoff for the same generation: exactly one committed identity.
- Different-generation simultaneous active creation: at most one active cycle.
- One contender aborting: the surviving transaction has correct state and no
  partial effects; test lock waits/deadlocks, not just final row counts.

Do not simulate these with sequential statements. Future atomic owner cancellation
requires a separate approved confirm_check_in change before it can be tested.

## Final decision gate

### PROVEN BY STATIC TEST

- [x] Nine static tests previously passed in
  guardian-escalation-safety-foundation.test.mjs, covering the declarations and
  statement restrictions explicitly asserted by that suite, not the entire SQL contract.
- [ ] Verify the tested artifact still matches the reviewed migration checksum
  before relying on that result for a later application.

The static suite is not a full SQL parser. Current static coverage does NOT fully
prove the exact logic of both timestamp CHECK constraints, every expected
constraint name, the exact partial-index name, or the complete absence of extra
clauses inside otherwise allowed DDL statements. These remain explicit review
and database-validation responsibilities; nine passing tests do not establish them.

### PROVEN BY DATABASE VALIDATION

Leave each box unchecked until executed successfully with retained evidence.

- [ ] Authorized target and disposable behavioral environment independently verified.
- [ ] Pre-migration schema, data, function, constraint, permission baselines captured.
- [ ] Reviewed migration committed successfully, without partial/uncertain outcome.
- [ ] Columns, constraints, ownership FK, indexes, RLS and effective ACLs verified.
- [ ] Existing row contents unchanged, zero generations, valid original engine states.
- [ ] Disposable behavioral matrix and account cascade passed.
- [ ] Existing functions, engine checks, triggers, and permissions unchanged.
- [ ] Migration rollback tested, or explicitly recorded as not proven.

### NOT YET PROVEN

- [ ] Genuine multi-session concurrency.
- [ ] Future atomic owner cancellation and generation advancement (not implemented).
- [ ] Future handoff, requests, tokens, quorum, safety processing, release or delivery.
- [ ] Full Auth API/external-service deletion behavior beyond database FK semantics.

This document records no database execution. Do not describe Step 1 as
production-safe on static tests alone. Successful foundation validation also
does not authorize enabling escalation creation or substitute for validation of
the later owner Check-in safety change. ARGOS authorization remains a separate gate.

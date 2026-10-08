# Change 2: owner Check-in database validation

This is an unexecuted runbook, not authorization to connect or apply SQL.
Target only separately authorized ETERPAX-TEST. Never production. Do not normalize
TEST permissions or synchronize unrelated production architecture. Use only
purpose-created disposable identities and Check-ins for behavioral tests; the
existing TEST account is not disposable. No credentials or user data in evidence
committed to the repository. No database validation has been performed by Codex.

## 0. Authorization and baseline

Before any connection, independently confirm the authorized project identity;
database name `postgres` alone does not identify a Supabase project. Obtain
separate application and disposable-fixture authorization. Capture the reviewed
file checksum and baseline externally in protected evidence.

Read-only catalog inspection must establish:

- Change 1 is installed unchanged, including both generation nonnegative checks,
  parent/owner FK, generation uniqueness and active partial unique index.
- `auth.uid()` exists; anon/authenticated roles exist. The operator can replace
  the function and retain postgres ownership.
- Both tables are postgres-owned, RLS enabled, not forced. Capture full table and
  column ACLs and policies. Do not change TEST's different Check-in ACL.
- Exact existing RPC signature, definition, owner, ACL, language, return type,
  security-definer flag and settings. PUBLIC and anon must not have effective
  EXECUTE (including inherited privileges); authenticated must have EXECUTE.
  STOP on unexpected additional RPC grantees rather than silently broadening or
  normalizing privileges. CREATE OR REPLACE preserves existing ACLs.
- All Check-in constraints and non-internal triggers. TEST is expected to lack
  production activation triggers. Investigate new triggers before running tests.
- Existing table contents and function definitions for before/after comparison,
  in an authorized quiet window. Counts alone cannot prove row equality.

Useful read-only function baseline (capture before and repeat after):

```sql
SELECT p.oid::regprocedure AS signature, p.proowner::regrole AS owner,
       p.prosecdef, p.proconfig, p.proacl,
       pg_catalog.pg_get_functiondef(p.oid) AS definition,
       pg_catalog.pg_get_function_result(p.oid) AS result_type
FROM pg_catalog.pg_proc p
WHERE p.oid = 'public.confirm_check_in()'::regprocedure;

SELECT r.rolname,
       pg_catalog.has_function_privilege(r.oid,
         'public.confirm_check_in()', 'EXECUTE') AS can_execute
FROM pg_catalog.pg_roles r
WHERE r.rolname IN ('anon', 'authenticated', 'service_role');

SELECT c.oid::regclass AS relation, c.relowner::regrole AS owner,
       c.relrowsecurity, c.relforcerowsecurity, c.relacl
FROM pg_catalog.pg_class c
WHERE c.oid IN ('public.check_ins'::regclass,
               'public.guardian_escalations'::regclass);
```

Minimum schema is Change 1 plus the existing fields used by the supplied RPC.
No activation/subscription, Guardian notification or email-outbox synchronization
is required. The existing positive-frequency CHECK may prevent constructing an
invalid-frequency row; do not disable it for a test.

## 1. Separately authorized application

Apply only `supabase/migrations/202610080001_guardian_escalation_owner_check_in.sql`
using an approved error-stopping runner compatible with its BEGIN/COMMIT. Do not
rerun Change 1. STOP on any error or ambiguous commit acknowledgement; verify
outcome read-only before any retry. The migration changes the RPC and its own
owner/execution boundary only; it must not change table data, table grants,
constraints, triggers or other functions. Compare those baselines afterward.

Verify postgres owner, SECURITY DEFINER, empty search_path, UTC, composite return
type, and effective authenticated/anon/PUBLIC execution boundary. Inspect the full
ACL as well as role checks. No browser escalation table writes may be introduced.

## 2. Single-session behavioral validation

Use disposable users A and B created through a separately approved fixture method.
No real users, content or account deletion is needed. Auth API effects cannot be
rolled back by SQL; fixture creation requires its own cleanup authorization.

Each case starts from an independently restored fixture. Use BEGIN/ROLLBACK;
SAVEPOINT before expected failures, then ROLLBACK TO SAVEPOINT before inspecting
unchanged state. Finish with ROLLBACK and a fresh-session comparison. Newly created
transaction records must disappear; pre-existing fixtures return to their captured
baseline. Do not disable constraints, triggers or RLS.

Invoke as authenticated with a harness-controlled, transaction-local subject for
A; verify auth.uid() is A before invoking. Never use a fabricated production JWT.
SQL role/claim simulation validates database authorization, not end-to-end Auth/API
behavior. Running every test as postgres does not establish caller isolation.
Use the authorized observer context to inspect the server-managed escalation rows.

For each successful call compare the returned row to persisted state and require:
generation g+1, missed_count 0, scheduled, response deadline NULL,
last_check_in_at = updated_at, and next_check_in_at equal to last_check_in_at plus
frequency_days days under UTC. Frequency, enabled and unrelated fields remain
unchanged. Newly written escalation timestamps equal last_check_in_at exactly.

| Case | Setup and required observation |
| --- | --- |
| No escalation | Parent at generation g; reset and g+1 with no child created |
| Existing states | Exercise scheduled, awaiting_response, escalation_pending where TEST constraints allow; same normal reset |
| Active matching | Independently test waiting and safety at generation g; cancelled with both timestamps set |
| Active mismatch | Independently test lower and higher child generation; both cancelled, parent advances only from g to g+1 |
| Repeat | Two successful calls produce g+2; first cancellation timestamps remain unchanged on second call |
| Terminal current | Negative and frozen at generation g, owner timestamp NULL: preserve outcome/closed_at and record owner timestamp |
| Existing acknowledgement | Current-generation terminal with timestamp already set: preserve it exactly |
| Older history | Older negative/frozen and prior cancelled rows remain byte-for-byte unchanged |
| Mixed history | Older terminal plus current active: only active cancelled; no history deletion |
| Ownership | Calling as B never changes A's parent or escalation; B without configuration gets P0002 |
| Missing identity | Authenticated execution with no subject fails 42501; no data changes |
| Anonymous | anon cannot execute the RPC; permission denial is expected before function authentication |
| Overflow rollback | Parent generation 9223372036854775807 plus valid active child; RPC fails numeric overflow (22003); after rollback to savepoint, child remains active and every parent field unchanged |
| Explicit rollback | Successful cancellation/reset followed by outer rollback restores both tables |

For overflow, the cancellation occurs before the parent arithmetic failure; this
tests statement atomicity rather than merely failing before any write. Repeat with
current-generation negative/frozen history to verify acknowledgement also rolls
back. Constraints must remain enabled. A NULL/invalid frequency guard can be
statically checked when the database correctly prevents such a fixture.

Record SQLSTATE, relevant fixture before/after state and cleanup evidence. A
client timeout is not proof of rollback: inspect outcome before retrying. Two
successful retries count as two Check-ins; there is no request-id deduplication.

## 3. Genuine concurrency — separate authorization/harness required

**CONCURRENCY NOT YET PROVEN.** Use independent connections and controlled lock
barriers; sequential statements do not prove these cases.

- Two owner calls: first holds the parent until commit; second waits and then
  advances the committed generation. Two successes yield two increments. Repeat
  with first transaction rolling back; only the committed call advances state.
- Owner versus applicable engine: owner-held rows are skipped by SKIP LOCKED;
  engine-first updates are followed by owner reset. Do not bypass the production
  engine's environment guard or copy production architecture into TEST. If a
  controlled simulation is used, label it protocol-only, not engine regression.
- Future handoff simulation: parent-before-child writer creates only after
  rechecking escalation_pending/current generation. Owner-first prevents creation;
  creator-first is cancelled by the waiting owner. This does not implement handoff.
- Future escalation mutation paths must acquire the same parent lock before child
  locks. The partial unique index alone does not supply this transaction protocol.

Change 2 acquires no owner advisory lock. Any future path needing that lock must
take it before the parent, never after. Direct service-role writes ignoring the
protocol are outside this concurrency guarantee.

## 4. Failure and rollback gate

On migration failure, verify transaction outcome; do not assume a disconnected
client rolled back. After successful application, prefer an authorized forward
correction. Restoring a cancellation-unaware RPC is unsafe if escalation workflows
are later enabled. Do not delete history, reset generation, or remove Change 1.
Any restoration needs its own reviewed baseline definition and authorization.

## 5. Evidence gate

- Static suite: SQL shape only, not a full SQL parser, database execution, RLS
  proof, transaction proof or concurrency proof.
- Database validation: mark each case passed only after execution with evidence.
  Until then, atomic cancellation and generation advancement remain NOT PROVEN.
- Migration application does not authorize production application or handoff.
- Full production regression, API authentication, request/token invalidation,
  Guardian responses, quorum, seven-day timeout, 48-hour processing, release and
  delivery remain outside the implemented/validated scope.

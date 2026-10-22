# Activation policy — phase 1

Base: Production sprint-1-landing at 077a41067f45d947e8b9a6c60ab4a7a396f4a4a4.

## Server contract

`get_account_activation_eligibility()` accepts no account ID and uses `auth.uid()`.
It reads subscription state and activation history without changing either. Any
active subscription wins, even if other subscription records are canceled.
An existing guardian_plan_activations record excludes a former subscriber.
Subscription records other than incomplete/incomplete_expired also exclude the
account conservatively (including trials, unknown statuses and null statuses).
Incomplete checkout alone is not evidence of a previous subscription.

For eligible unpaid accounts the start is the later of auth.users.created_at and
the singleton policy activation timestamp. Preparation is [start, start+15 days),
recovery is [start+15, start+30 days), and review_pending begins at start+30.
All intervals are calculated in UTC on the database server. Browser time does
not determine the state. Loading/errors never display a fabricated expiration.

The singleton timestamp is persisted when the migration is applied. Reads do
not reset it. This migration is not a recurring script: do not re-create the
singleton to change the activation date. New accounts require no new trigger.

## Deliberately not implemented

No email, cron, write restriction, final notice, review queue, deletion or change
to payment, Guardian, Check-in, Continuity Engine or recipient delivery flows.
`review_pending` is a computed informational state, not a recorded deletion job.
A later phase must persist the actual final-notice timestamp and allow at least
seven additional days from that notice; day 37 is not automatic authorization.
The recovery UI does not claim that write restrictions are already enforced.
This RPC is not an authorization gate for any existing flow.

## Integration proposal

1. Review this isolated diff and the policy activation timing. Recheck the remote
   Production head; integrate the narrow patch without overwriting newer work.
2. Before applying SQL, confirm the deployed schema has subscriptions(user_id,
   status) and guardian_plan_activations(user_id), as the versioned migrations do.
   Confirm historical subscribers have evidence in one of those tables. Deleted
   subscription history cannot be reconstructed by this implementation.
3. Apply 202610210002_account_activation_policy.sql once, in its transaction,
   at the approved activation time. This starts the old-account 15-day clock.
   It is independent of the welcome-email migration and does not touch auth.users.
4. Publish the Dashboard change after the RPC exists. Until it exists, the new
   UI reports status unavailable; it does not block navigation or payments.
5. Verify representative accounts read their own state. No production test has
   been run as part of this implementation. Do not remove the activation record
   during a UI rollback. Later enforcement must account for the elapsed period.

## Focused local validation

- node --test tests/activation-policy.test.mjs
- python3 tests/activation-policy-integration.py (disposable PostgreSQL; set
  PG_BIN if binaries are not at /usr/local/opt/postgresql@17/bin)
- node_modules/.bin/tsc --noEmit --incremental false
- node_modules/.bin/eslint app/dashboard/page.tsx lib/activation-policy/presentation.ts tests/activation-policy.test.mjs

The SQL test covers exact microsecond boundaries, old and new accounts, days
7/13/15/16/30/37, active priority with multiple subscriptions, historical
exclusion, initial incomplete checkouts, unknown statuses, authenticated account
isolation and denied anonymous execution/private table permissions.

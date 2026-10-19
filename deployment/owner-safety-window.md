# Owner safety window email

Scope: one durable `owner_safety_window` event per escalation, using the existing outbox,
lease/claim worker, Resend account and authenticated Dashboard cancellation. No message
release or majority/deadline changes. No new environment variables.

## Application order (requires operational authorization)

1. Pause Continuity scheduler dispatch before the migration/deployment boundary and wait
   for existing invocations to finish. Do not run the old worker on the new events: it
   does not recognize their type. Keep all other existing feature settings unchanged.
2. Apply `supabase/migrations/202610190001_owner_safety_window_email.sql` in its entirety,
   once, after the existing Guardian Verification dispatch/response and owner-claim
   migrations. It is transactional and rejects an unexpected legacy event constraint.
   It adds a transition trigger and recovery function but does not run recovery or send
   email during installation. Migration application is not performed by this change.
3. Deploy the matching worker code. Confirm deployment success before resuming the
   scheduler's prior configuration. Do not invoke the cron manually as a smoke test.
4. The next authorized scheduled claim recovers missing active windows (up to 25 per
   invocation), then claims both event types. The current escalation is included if it
   remains active, unexpired and consistent with its parent generation. Its original
   majority/deadline are copied, never reset. No event is created for expired windows.
5. Inspect the outbox event for that escalation: one row, original deadline, expected
   owner, and eventual `sent` with provider ID. Provider acceptance is not proof of inbox
   delivery. Verify actual receipt separately. Never requeue `uncertain` automatically.
6. The button opens login, then Dashboard. The authenticated owner must explicitly choose
   "I'm OK"; existing `confirm_check_in()` cancels active escalations and rearms Check-in.
   Opening an email/link alone changes nothing. A real cancellation test changes business
   state and requires a designated test escalation and explicit operational authorization.

## Semantics and limits

- Partial unique index prevents duplicate events even during recovery or concurrent votes.
- Recovery locks parent then escalation, matching existing voting/cancellation lock order.
- Pending mail is cancelled on leaving safety_window. Claimed mail is checked again before
  provider submission, including owner, generation and exact original deadline.
- As with existing delivery, a cancellation after the final database read cannot recall an
  email already submitted to an external provider. It still stops the protocol in the DB.
- The approved 48-hour subject/heading is accompanied by the actual UTC deadline and an
  explicit statement that delayed email does not restart the window.
- Expired leases and ambiguous provider outcomes remain `uncertain`, never blindly retried.
- The owner-specific manual Check-in dispatch remains limited to `check_in_request`.
- Production schema/privileges are not changed until this migration is explicitly applied.

## Local verification

`node --test tests/owner-safety-window.test.mjs tests/continuity-manual-dispatch.test.mjs tests/continuity-scheduler.test.mjs`

`python3 tests/owner-safety-window-lab.py` uses a disposable PostgreSQL 17 cluster with a
Unix socket and no network listener. It verifies transition, recovery, unchanged dates,
cancellation, concurrent claims, uncertain leases and restricted RPC grants.

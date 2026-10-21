# Welcome email — pending review, not activated

Base: Production 2cb3855. This change does not alter Auth settings or require a session/confirmation to send the welcome. Existing browser navigation is unchanged. Only the user-object console log is removed from Create Account.

After approval, apply `supabase/migrations/202610210001_welcome_email.sql` and deploy the matching code/cron. Applying the migration starts capturing new non-anonymous accounts with an email; it never backfills existing accounts or enqueues profile updates. Do not apply it before accepting the rollout boundary. No migrations have been applied to Production by this implementation.

The trigger only inserts a local queue row in the account-creation transaction; it performs no network requests. Enqueue exceptions (including query cancellation inside the trigger) are caught so the account insert can complete. The worker recovers missing queue rows only for accounts created at or after the durable migration activation timestamp. A database outage or connection/transaction failure outside this trigger cannot be made recoverable by an email feature. Provider availability cannot affect signup or navigation. Account metadata/email are snapshotted at creation and inaccessible to anon/authenticated clients. Accounts without a usable first name or address are marked invalid without sending.

The independent `/api/cron/welcome-email` job runs once per minute, handling up to three accounts per invocation. It uses existing `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `RESEND_API_KEY`, plus the existing verified sender. The fixed dashboard URL is `https://www.eterpax.com/dashboard` and contains no credentials. No other worker is changed.

A unique user ID plus an atomic `FOR UPDATE SKIP LOCKED` claim authorizes at most one provider attempt per account, even across workers. Resend gets a stable per-account idempotency key. A timeout, rejection, process crash or unknown finalization never requeues a potentially submitted message. Reservations older than five minutes become uncertain. Review uncertain/invalid rows administratively; do not reset them or blindly resend. Exactly-once inbox delivery cannot be guaranteed by a database/provider integration. `accepted` means accepted by Resend, not confirmed inbox receipt.

HTTP responses expose counts and fixed error messages only. No name, address, tokens, provider error text or raw database error is logged.

Validation:
- `node --test tests/welcome-email.test.mjs`
- `python3 tests/welcome-email-lab.py` (disposable PostgreSQL 17, Unix socket only)
- `node_modules/.bin/tsc --noEmit --incremental false`
- Targeted ESLint for the welcome modules, route, CreateAccountView and test.

`previews/emails/welcome.html` and `welcome.txt` contain a fictional name, generated from the actual template. No real mail was sent.

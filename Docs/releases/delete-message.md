# Delete Message release

Base: `origin/sprint-1-landing`, `2388c943885f7edc01d75e657143faaec24c5b65`.
Branch: `release/delete-message`. No new npm dependencies or lockfile changes.

## Scope

The message page and deletion hook, authenticated deletion endpoint, registered
uploads, durable cleanup, manual recovery endpoint and scheduled recovery endpoint.
Only migrations `202610130001` through `202610130004` and their local tests are
included. Guardian Verification and Continuity application changes are excluded.

## Existing database contract

The four migration files are preserved byte for byte from the source workspace.
They are historical records of migrations reported as already applied in production;
do not reapply them. No additional migration is required by this release.

001 provides upload registration/completion, removal queues, file references,
write/read guards and durable inventory. 002 adds before/after Storage metadata
verification. 003 adds deletion safety and finalization. 004 replaces the pilot
functions with global settings, owner-scoped deletion, multiuser cleanup and batch
finalization. The old UUID in historical 001/003 is removed from effective deletion
functions and the rollout constraint by 004. Existing and future accounts need no
per-user enrollment.

004 also requires existing `check_ins`, `guardian_escalations`,
`guardian_verification_notifications` and `guardian_verification_emission_attempts`.
The local PostgreSQL lab validates the four migrations against fixture versions of
these contracts; it does not certify the live schema or migration checksums.
This isolated branch is not a fresh-database bootstrap for the unrelated Guardian
schema. No remote SQL or production reads were performed.

The code calls the 004 RPCs: `request_message_deletion`,
`finalize_message_deletion`, `claim_message_file_cleanup_scoped`, and
`finalize_message_deletion_batch`, plus the preserved upload/verification RPCs.
Deletion applies to owned drafts with no unresolved continuity/delivery state.
Shared attachments are retained; unknown outcomes preserve inventory for recovery.

## Configuration for a later authorized launch

Nothing is activated by this commit. The application requires server settings
`MESSAGE_DELETE_ENABLED=true`, `MESSAGE_RECOVERY_ENABLED=true`, and
`MESSAGE_RECOVERY_AUTOMATIC_ENABLED=true` for the full feature. Recovery authenticates
with `CRON_SECRET` (at least 32 non-whitespace characters); manual recovery uses a
separate `MESSAGE_RECOVERY_SECRET`. Both use `SUPABASE_URL` and
`SUPABASE_SECRET_KEY`; the browser's existing Supabase configuration must identify
the same project. No credentials are committed.

Database `message_file_settings` must have coordination, deletion, recovery and
`private_delivery_reviewed_disabled` enabled after the corresponding review.
Current values were not inspected or changed. Coordination cannot be turned off
beneath in-flight uploads; preserve its guards and inventories during rollback.

`vercel.json` retains `/api/cron/continuity` at `0 * * * *` and adds
`/api/cron/message-recovery` at `* * * * *`. Continuity's route, code and independent
`CONTINUITY_SCHEDULER_ENABLED` gate remain identical to production. Future Continuity
work must merge this additive cron configuration, not replace the cron array.
The hosting plan must support the configured minute cadence; no Vercel deployment
or account configuration was inspected or changed.

## Validation

- `node --test tests/*.test.mjs`: 43 passed before adding the release contract tests.
- `python3 tests/message-file-coordination-lab.py`: passed in disposable local
  PostgreSQL, including upgrade preservation, cross-owner isolation, no enrollment,
  grants/RLS, shared files, late arrivals, finalization and concurrent claims.
- TypeScript: `node_modules/.bin/tsc --noEmit --incremental false` passed.
- Release cron regression test: 1 passed (44 Node tests total).
- Final TypeScript check after page edits: passed.
- Lint on all modified JS/TS files: 0 errors, 17 page warnings. Two purity
  diagnostics were narrowly suppressed because the code runs inside an input
  change handler; the JSX apostrophe was escaped.
- `git diff --cached --check` reports one existing blank line at EOF in migration
  003. It is deliberately preserved to keep the applied migration byte-identical.
- Production build: `npm run build` passed with Next.js 16.2.10/Turbopack;
  34 static pages generated and all three new endpoints present. Used fictitious
  Supabase/Stripe/KMS build values, with no production credentials or activations.
  Network permission was needed for the existing Google Fonts imports.
- No local release blocker remains. Live schema/settings, Vercel minute-cadence
  availability and real browser/Storage integration remain unverified.

The SQL lab simulates Storage metadata; no real Storage object is deleted and no
end-to-end browser/Storage production test is claimed.

## Included files

- `Docs/releases/delete-message.md`
- `app/(auth)/your-messages/page.tsx`
- `app/api/admin/messages/recover/route.ts`
- `app/api/cron/message-recovery/route.ts`
- `app/api/messages/delete/route.ts`
- `components/messages/useMessageDeletion.ts`
- `lib/messages/capabilities.ts`
- `lib/messages/cleanup.ts`
- `lib/messages/deletion-server.ts`
- `lib/messages/recovery-executor.ts`
- `lib/messages/uploads.ts`
- `supabase/migrations/202610130001_message_file_coordination.sql`
- `supabase/migrations/202610130002_message_cleanup_verification.sql`
- `supabase/migrations/202610130003_controlled_message_deletion.sql`
- `supabase/migrations/202610130004_multiuser_message_deletion.sql`
- `tests/message-deletion.test.mjs`
- `tests/message-file-coordination-lab.py`
- `tests/message-file-coordination.test.mjs`
- `tests/message-multiuser-assertions.sql`
- `tests/message-multiuser-fixtures.sql`
- `tests/message-recovery-executor.test.mjs`
- `tests/message-release.test.mjs`
- `vercel.json`

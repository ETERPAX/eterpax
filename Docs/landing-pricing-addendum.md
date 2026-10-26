# Landing pricing completion

Base: `66c16d9`. Worktree: `/private/tmp/eterpax-landing-pricing-final`.

The landing now renders Monthly ($4.99 USD/month), Annual ($49.99 USD/year),
and Founder's Lifetime ($99.99 USD one-time, limited to 2,000 users) directly
from `lib/billing/plans.ts`, using the existing `PricingCard`. No commercial
amounts, plan limits, availability logic, or checkout logic are duplicated.
`LanguageProvider` and the existing EN/ES plan translations are reused.

Each card opens a public, informational native dialog with the same canonical
plan data and a link to create an account. It does not initiate checkout or
query subscription state. The existing landing journey popup and the dashboard
`YourPlanModal`/`PlanSelection` remain in place. The approved bilingual no-card
reassurance and the separate 15-day creation + 15-day plan-choice explanation
are unchanged. This is not a new Stripe trial. The hero uses Next Image with
its existing asset and positioning, unoptimized, removing its lint warning.

## Validation

- TypeScript: `tsc --noEmit --incremental false` passed.
- Changed source files: ESLint with `--max-warnings 0` passed.
- Full repository ESLint: 0 errors, 33 warnings in 14 untouched files verified
  byte-identical to the base commit. Global IDE “Problems = 0” is not certified;
  the editor's Problems panel is not exposed by this environment.
- Existing EN/ES catalog/interface suite: 5/5 passed.
- `git diff --check`: passed.
- Chrome browser verification and screenshot review: EN and ES at 1440x900,
  390x900 and 320x900; all six combinations passed. Desktop cards align in three
  columns; mobile cards stack and prices/periods wrap without page overflow.
  All three public plan dialogs show the correct data; Escape and Close work
  and return keyboard focus to the opener. The existing journey popup opens
  and closes. Signup navigation reaches the six-field form with no card input.
  Zero uncaught JavaScript errors and zero Stripe/checkout requests observed.
  This run did not submit signup and is not real authenticated-flow validation.
  Screenshots, runner and results: `/private/tmp/eterpax-pricing-evidence/`.
- Development-generated route types were malformed during the preview session.
  The local dev server was stopped and the generated directory archived outside
  the worktree before regenerating types with `next typegen`. No source types
  or TypeScript settings were changed.
- No production build, physical-device test, push, or deployment performed.

## Owner verification: real signup without a card

This remains a release check. A visible registration form and source inspection
are not proof of a successful real signup or authenticated free-phase session.
No account has been registered or payment submitted by this task. Owner access
to a fresh email inbox is needed to finish verification.

1. Keep the local preview running from this worktree with
   `./node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port 3108`.
   Its ignored `.env.local` contains only the existing public browser Supabase
   configuration. Do not paste credentials into this document or a chat.
2. Open `http://127.0.0.1:3108/` in a private browser window. Select EN or ES.
   Confirm the three prices, the 2,000-user limit, no-card statement and 15 + 15
   explanation. Open/close plan details; no payment page should open.
3. Click “Create Your First Message” / “Crea tu primer mensaje”. Use an email
   you control that is not already registered; enter the requested personal
   information, password and confirmation, then Continue / Continuar.
4. If email confirmation is required, confirm through your own inbox. Return
   to `http://127.0.0.1:3108/login` and sign in. Note any redirect, error, or
   unexpected checkout; do not change auth settings to force the test through.
5. Confirm that `/dashboard` opens as the new user and that the message editor
   can be opened during preparation without entering card data or buying a
   plan. Do not send a message, trigger delivery, or purchase a plan.
6. Record date, language, successful email confirmation (if required), dashboard
   access, editor access, and whether a card/checkout appeared. Optionally use
   DevTools Network with Preserve log to confirm no `/api/checkout` request
   occurred before intentionally choosing a paid plan. Do not share tokens,
   passwords, or unredacted network exports. Repeat the UI navigation in the
   other language; a second signup is only needed if checking registration in
   both languages end to end.

Stripe, Supabase configuration/schema, webhooks, subscriptions and checkout code
were not modified. Push and deployment still require the owner's authorization.

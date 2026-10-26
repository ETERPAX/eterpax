# Landing pricing: compact informational popup

Correction base: `172de75`. Visual reference: `07c90bf`.

## Scope

The original landing composition, photograph, hero markup, copy, signup/login
links and “How ETERPAX works” popup are restored. The only addition to the
original page is the “Plans & pricing” / “Planes y precios” trigger next to the
existing informational trigger, with a wrapping container for narrow screens.
A source comparison confirms the rest of the original page is identical.
`PricingCard` is restored byte-for-byte to `07c90bf`.

There is no permanent pricing section, card grid, individual plan popup, or
no-card paragraph beneath the hero CTA. A single compact informational dialog
uses the existing journey popup's colors, translucent background, rounded
corners, blur, close control and scrollable layout. Its native dialog behavior
also supports Escape, focus containment and return to the opener.

Prices and plan descriptions come from unchanged `lib/billing/plans.ts`:
Monthly $4.99 USD/month, Annual $49.99 USD/year, Founder's Lifetime $99.99 USD
one-time with the existing 2,000-user limit. Existing EN/ES translations supply
the plan text, approved 15 + 15 explanation and no-card reassurance.
No plan-selection buttons, purchase links, checkout calls or subscription
queries are included in the popup. This does not introduce a Stripe trial.

Registration, login, Dashboard, Messages, Guardians, Check-in, billing,
Supabase, subscriptions, APIs, routes and deployment configuration are unchanged.
No destructive reset or unrelated rollback was used.

## Validation

- EN/ES catalog/interface tests: 5/5 passed.
- Targeted ESLint: 0 errors, one existing `no-img-element` warning from restoring
  the original hero image markup. The warning is not suppressed.
- TypeScript: `tsc --noEmit --incremental false` passed.
- Local Chrome: EN/ES at 1440x900, 390x900 and 320x900 passed. No permanent
  prices, horizontal overflow, uncaught JavaScript errors or checkout requests.
  Both popups open/close; pricing also closes with Escape and returns focus.
  Three prices, lifetime limit, 15 + 15 and no-card copy verified in the dialog.
  Desktop/mobile screenshots reviewed. Evidence and browser runner are in
  `/private/tmp/eterpax-pricing-correction/`. Physical devices were not tested.
- `git diff --check`: passed.
- No push or deployment of this correction.

## Pending owner verification

Real signup without a card remains unverified. No signup, email, payment or
subscription action was performed or simulated. The owner must use a new email
under their control, create the account, confirm email if required, then verify
access to the dashboard and message editor without entering card details or
buying a plan. Do not send messages, trigger delivery, or share credentials.
This visual correction does not change that flow or its verification status.

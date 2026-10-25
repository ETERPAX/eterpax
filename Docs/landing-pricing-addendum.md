# Landing pricing addendum

Base: origin/sprint-1-landing, 07c90bf. Branch: feature/landing-pricing-copy.

The approved EN/ES reassurance is beside the primary signup CTA. The approved
headline and full 15 + 15 explanation appear in a new informational pricing
section: the existing Landing had no pricing section. No prices or plan terms
were invented. Existing LanguageProvider/dictionaries are reused. Fluid widths
and responsive text sizes preserve wrapping; the hero image keeps its own bounds.

Source inspection: CreateAccountView collects personal information and passwords,
calls supabase.auth.signUp and navigates to /dashboard. It does not collect card
information or call checkout. PlanSelection invokes /api/checkout after plan
selection. Existing SQL defines preparation before day 15 and recovery before
day 30. No subscription, Stripe trial, auth or policy changes were made.

Publication gate: a real end-to-end signup and free-phase session MUST confirm
that no card is requested before subscription. Source inspection is not that
confirmation. No real signup, email, payment or deployed database verification
was performed in this task. Desktop/mobile visual verification also remains
pending; responsive layout is implemented in the source.

Validation: TypeScript passed; targeted ESLint passed with one existing img
warning and no errors; all five EN/ES catalog tests passed; git diff --check
passed. No production build or real-device browser test was run for this copy-only
change. No push or deployment.

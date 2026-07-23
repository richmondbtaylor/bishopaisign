# BishopAI Sign Upgrade Plan

Scope is large. I'll ship in six phases in this order so nothing existing breaks. Each phase is independently testable.

---

## Phase 1 - Landing page repositioning (frontend only)

Edit in place, no new components/styling system:

- `HeroSection.tsx`: swap headline to "Send, sign, and close. In minutes, not days.", subhead to the new copy, primary CTA label to "Start free", add trust strip line under CTAs.
- `FeaturesSection.tsx`: expand from 6 to 10 cards using existing card style. Copy exactly as specified.
- New `ComparisonSection.tsx` (matches existing section styling) inserted between Features and Pricing. Simple 3-row table: Price, Envelope limits, Setup time.
- `PricingSection.tsx`: rebuild tiers to Free / Pro / Business with the exact numbers. Add a monthly/annual toggle above the cards; middle card highlighted "Most popular"; trial line under grid.
- `Index.tsx`: mount `ComparisonSection` in the right spot.

No backend work in this phase.

---

## Phase 2 - Stripe subscriptions

**Enable Lovable's built-in Stripe payments** (seamless, no BYOK). Then:

- Migration: new `subscriptions` table (`user_id`, `org_id`, `stripe_customer_id`, `stripe_subscription_id`, `plan`, `billing_interval`, `status`, `trial_ends_at`, `current_period_end`, timestamps). GRANTs + RLS: users read only their own row; service_role full access.
- Products/prices: Pro ($15/mo, $8/mo billed annual) and Business ($22/user/mo, $13/user/mo billed annual) via the Lovable products flow.
- Edge functions:
  - `create-checkout-session` - authed, takes `{plan, interval}`, creates Checkout with 14-day trial.
  - `create-portal-session` - authed, opens Stripe customer portal.
  - `stripe-webhook` - `verify_jwt=false`, verifies Stripe signature, upserts subscription rows on `customer.subscription.*` and `checkout.session.completed`.
- Pricing card CTAs: authed → checkout; unauthed → `/auth?next=checkout&plan=...&interval=...`, resumed after login.
- Dashboard billing: new `/dashboard/billing` route with current plan, renewal date, Manage billing button.
- Feature gating (server-side in `send-sign-request` + client hints):
  - Free = 5 sent docs / calendar month (query documents table).
  - Bulk send + team features = Business only.
  - Over-limit returns structured `upgrade_required` payload; UI shows upgrade prompt modal, not an error toast.
- Trial banner: dismissible banner on Dashboard when `status='trialing'`, with days remaining and Upgrade CTA (localStorage dismissal per session).

---

## Phase 3 - Welcome email

- New template `_shared/transactional-email-templates/welcome.tsx` matching existing brand styles. Props: `firstName`, `plan`, `trialEndsAt?`, `ctaUrl`. From-name "Richmond at BishopAI Sign". Subject template as specified.
- Register in `registry.ts`.
- Migration: add `welcome_email_sent_at timestamptz` to `profiles`.
- Trigger: in `useAuth` on first successful sign-in, call `send-transactional-email` with idempotency key `welcome-{user_id}` and update `welcome_email_sent_at`. Server also double-checks the column before sending to be safe.
- Deploy `send-transactional-email` after registry change.
- Dashboard header greeting: "Welcome back, {firstName}".

---

## Phase 4 - New field types

- Extend `document_fields` and `template_fields`: allow `field_type IN ('signature','date','text','initials','checkbox')` (drop/replace CHECK constraint via migration).
- `DocumentEditor.tsx`: add Initials + Checkbox to the field palette, following the exact signature/date/text pattern (color-coded, resizable, per-signer).
- `SignDocument.tsx`: interactive Initials (mini adoption dialog reusing script font logic, first+last initials autofill) and Checkbox (toggle) with the same status badges, jump-to-next, and a11y treatment already used for other fields.
- `finalize-document`: render initials in the selected script font, checkbox as ✓ glyph in the flattened PDF.

---

## Phase 5 - Bulk send

- Migration: `bulk_batches` (template_id, sender_id, org_id, csv_row_count, status) and `bulk_recipients` (batch_id, document_id?, name, email, status, error). RLS by sender_id + org.
- Templates page: "Bulk send" action per template opens a dialog:
  1. Paste CSV or upload file.
  2. Parse client-side (papaparse), preview table with validation.
  3. Confirm → new `bulk-send` edge function creates one document per row from the template (reusing existing template→document logic) and enqueues the invite email for each. Gated to Business plan.
- Dashboard: new "Bulk batches" section showing per-batch progress + per-recipient status drill-in.

---

## Phase 6 - Automatic reminders

- Migration: `document_reminders` (document_id, signer_id, scheduled_for, sent_at, attempt). Default schedule seeded when doc moves to `sent`: +2 days, then +3, +3, max 3.
- New template `reminder.tsx` in `_shared/transactional-email-templates/`, registered.
- New edge function `process-reminders` invoked by pg_cron every 15 minutes: picks due, unsigned reminders, calls `send-transactional-email`, marks sent. Skips completed/declined docs and any signer already signed.
- `DocumentView`: "Send reminder now" per unsigned signer (uses same template, records attempt).

---

## Technical notes

- All new edge functions include the shared `corsHeaders` import pattern and Zod input validation.
- All new tables follow the CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY order. Service_role always granted; anon never.
- No changes to existing edge functions except: (a) `send-sign-request` gains free-tier limit check + upgrade payload, (b) registry.ts adds two templates, (c) `finalize-document` gains initials/checkbox rendering.
- Existing Vitest deep-link test and Playwright overlay test remain untouched; will add smoke tests for the pricing toggle and CSV parser only.
- Em-dash rule respected everywhere.

Ship phases 1→6 in that order. Confirm to proceed and I'll start with Phase 1.

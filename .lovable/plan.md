
# BishopAI Sign — Fix & Complete Plan

## Phase 1 — Audit (current state vs target)

### What's broken / incomplete now

**Branding (all UI)**
- App still renders as "SignVault" (see `src/pages/SignDocument.tsx` line 212, `src/pages/Dashboard.tsx` line 85, landing components). Needs global rename to **BishopAI Sign** and navy/gold palette in `src/index.css` + `tailwind.config.ts`. Trust-critical since users must recognize who is asking them to sign.

**Field placement (`src/pages/DocumentEditor.tsx`)**
- `handleCanvasDrop` (line 143) hardcodes `page: 1` and stores raw pixel `x/y/width/height` from the canvas bounding rect — coordinates are relative to the entire multi-page container, not the specific page. At signing time `SignDocument.tsx` doesn't position fields at all (they're not rendered on the PDF). Result: fields drift/disappear for signers.
- Coordinates need to be stored in a page-relative, resolution-independent unit (percent of page width/height, plus `page_number`) so they render pixel-accurate at any width.
- No per-page drop zones — one giant canvas div wraps every `<Page>`, so `page_number` cannot be derived from the drop event.

**Signer routing (`send-sign-request` + `signing-session`)**
- `send-sign-request/index.ts` line 57 chooses recipients client-side by mode, but there's no server-side enforcement in `signing-session`. A sequential signer #2 can open their link and sign out of order because `signing-session` returns the PDF + fields regardless of prior signer status. Breaks "signer 2 cannot sign until signer 1 completes."
- `submit-signature` also doesn't re-check ordering before accepting the signature.

**Emails**
- `send-sign-request/index.ts` only `console.log`s the signing URL (line 67). No email is actually delivered. No completion email, no decline email, no expiration email. This is the biggest end-to-end blocker.
- No email domain is set up. Need Lovable Emails infra + verified domain (user action) before real delivery.

**Finalized PDF**
- No flattening step anywhere. `submit-signature` just marks signers as signed; the completed PDF with rendered signatures/dates never gets written to `completed_file_path` (column exists, unused). Downloading a "signed" copy currently returns the original blank PDF.
- No certificate of completion / audit page appended.

**Audit trail**
- `document_signers` viewed/signed events are captured, but no rows written to `audit_logs` for: viewed, signature adopted, declined, expired, downloaded. `submit-signature` logs `document_signed` only. IP is captured on the signer row, not on every audit event.

**Edge cases — all missing**
- No decline flow (no UI button, no `declined` status transition, no email, no invalidation of remaining tokens).
- `documents.expires_at` column exists but nothing checks it. Signing links work forever.
- Invalid/used token: `signing-session` returns 404 JSON but `SignDocument.tsx` shows a generic "Invalid Link" — acceptable, but expired/used cases aren't distinguished.
- Out-of-order: no "waiting on prior signer" state.
- PDF validation: `handleFileUpload` only checks MIME type, not that the PDF actually parses.
- Concurrent access: `submit-signature` doesn't do a conditional update — two simultaneous submits could both flip status.

**Guest download**
- Signers get no post-signing download link. Completion screen is a dead end.

### What already works and must be preserved
- Supabase auth, `useAuth` hook, `RequireAuth` route guard, password reset flow.
- Dashboard listing, filters, search.
- Token-based `signing-session` / `submit-signature` architecture using service role (correct security shape — extend, don't replace).
- RLS policies from recent security hardening — keep intact; all new access continues via edge functions.
- `react-pdf` rendering pipeline.
- Storage `documents` bucket + signed URLs.

### Target working state
Sender uploads PDF → drags signature/date fields onto specific pages → assigns signers with routing order → clicks Send → each signer gets an **email** with a unique link → sequential order enforced server-side → signer opens link, sees PDF with their fields pixel-accurately overlaid at correct positions → adopts signature (type/draw/upload) → submits → last signer completion triggers **pdf-lib flattening** + certificate of completion → all parties receive a **completion email with signed-PDF download link** → dashboard reflects every state, audit trail is complete with IP/timestamp per event.

---

## Phase 2 — Implementation

### Branding
- Replace all "SignVault" strings with "BishopAI Sign" (Dashboard, SignDocument, landing components, `index.html` title/meta).
- Update `src/index.css` design tokens: primary `#1B2A4A` (navy), accent `#C9A227` (gold), keep Space Grotesk headings / Inter body.
- Update logo mark background from emerald to navy.

### Database migration (additive only, preserves RLS)
- Add `documents.decline_reason text`, `documents.declined_by_signer_id uuid`.
- Add `document_signers.declined_at timestamptz`.
- Add `document_fields` percent-based columns: `x_pct`, `y_pct`, `w_pct`, `h_pct` (double precision). Keep legacy px columns for back-compat.
- Add index on `document_signers(document_id, signing_order)`.

### Editor rewrite (targeted, in `DocumentEditor.tsx`)
- Wrap each `<Page>` in its own drop-zone div with `data-page={n}` and its own bounding rect. Store `x_pct`, `y_pct`, `w_pct`, `h_pct` relative to the page rect. Render existing fields per-page using the same rects.
- Persist both pct + px on save; signer view reads pct.
- Add "Expires on" date picker (writes `documents.expires_at`).

### Signer view rewrite (`SignDocument.tsx`)
- Render each PDF page inside a positioned wrapper; overlay this signer's fields absolutely using stored pct * pageWidth/pageHeight so fields land exactly where the sender placed them.
- Show "Waiting on [prior signer name]" state when `signing-session` returns `waiting: true`.
- Show distinct "Expired" and "Already signed / declined / invalidated" screens.
- Add **Decline** button with reason textarea → posts to new `decline-signature` edge function.
- After successful signing: completion screen shows a "Download signed copy" button (available once envelope is `completed`).

### Edge functions

**`signing-session` (extend)**
- Reject if `documents.expires_at < now()` → return `{ expired: true }`; auto-flip document to `expired`, log audit, notify sender.
- In sequential mode, if any prior-order signer's status ≠ `signed`, return `{ waiting: true, waitingOn: <name/email> }` and do not return PDF/fields.
- Log `document_viewed` in `audit_logs` with IP + user_agent on first view.

**`submit-signature` (extend)**
- Re-check ordering and expiration server-side before accepting.
- Use conditional update: `.eq('id', signer.id).neq('status','signed')`; if 0 rows updated, return 409 (concurrent-safe).
- Log `document_signed` with IP/UA (already done — keep).
- When last signer completes → invoke new `finalize-document`.
- After successful sign in sequential mode → invoke `send-sign-request` for the next signer only.

**`decline-signature` (new)**
- Validates token, marks signer `declined`, sets `documents.status='declined'`, stores reason, invalidates remaining signers by rotating their tokens (`token = gen_random_uuid()` on rows where `status != 'signed'`) so old links 404.
- Emails sender: "X declined [document]". Logs audit with IP.

**`finalize-document` (new)**
- Loads original PDF from storage, uses `pdf-lib` (npm specifier) to draw each field's value onto its page at (x_pct*pageW, y_pct*pageH) with correct sizing:
  - `signature` type → embed PNG (from `signature_data.image` for draw/upload) OR render typed name in a script-styled text.
  - `date` type → render text.
  - `text`/`initials` → render text.
- Appends a **Certificate of Completion** page listing document title, envelope id, each signer's name/email/IP/timestamp/method, and event log.
- Uploads to `documents/{userId}/completed/{docId}.pdf`, writes `completed_file_path`.
- Invokes `send-completion-emails`.

**`send-sign-request` (rewrite email path)**
- Replace `console.log` with real send via Lovable Emails `send-transactional-email` using a `signing-invitation` template.
- Falls back to logging only if email infra not yet configured; surface a warning to sender.

**`send-completion-emails` (new)**
- Emails sender + all signers with a short-lived signed URL to `completed_file_path`. Logs `document_downloaded` when signed URL is requested via a small `get-completed-download` function that also enforces recipient token/session check.

**`expire-documents` (cron, optional — can be a manual "check on load")**
- Since pg_cron requires infra setup, do lazy expiration inside `signing-session` and a dashboard-load sweep on the sender's docs (server-side via existing RLS + client trigger).

### Email templates (React Email under `supabase/functions/_shared/transactional-email-templates/`)
1. `signing-invitation.tsx` — link, sender name, document title.
2. `document-completed.tsx` — download link, signer list.
3. `document-declined.tsx` — signer name, reason.
4. `document-expired.tsx` — sender notification.

### Concurrency & validation
- All `documents.status` transitions use conditional `.eq('status', <expected>)` updates.
- Editor upload: after `URL.createObjectURL`, attempt `pdfjs.getDocument(url).promise` to confirm parseable PDF; reject if it throws.

### Audit event coverage
`document_created`, `document_sent`, `signing_link_sent` (per signer), `document_viewed` (per signer), `signature_adopted`, `document_signed`, `document_declined`, `document_expired`, `document_completed`, `document_downloaded` — each with `actor_email`, `ip_address`, `user_agent` inside the edge function.

### Testing checklist (delivered to user at end)
Two-email test: create doc → upload PDF → place signature+date fields on pages 1 and 2 → add 2 signers sequential → send → signer 1 email arrives → sign → signer 2 email auto-sends → sign → both parties receive completion email with flattened PDF + certificate. Then repeat with decline mid-flow and with an expired envelope.

---

## Prerequisite user actions (required before real email delivery)
- Set up a verified email sender domain in Cloud → Emails. Until this is done, `send-sign-request` will fall back to logging the URL and surface a warning; the rest of the flow still works end-to-end for testing via the copy-link button on the document view.

## Out of scope (explicit)
Templates page enhancements, bulk send, in-person signing, checkbox/dropdown/initials rendering in the final PDF (only signature + date + text are flattened), SMS step-up (columns kept, not wired), team/org branding.

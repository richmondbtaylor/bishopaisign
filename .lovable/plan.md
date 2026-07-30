## What I verified first

- The PIN gate is already gone: `src/components/PinGate.tsx` does not exist and nothing in `src/` references it or the code `8226`. No work needed there.
- The four e2e specs you asked about earlier already exist (`template-initials-placement`, `initials-rotated-pages`, `completion-retry-timeouts`, `initials-mixed-methods`). They are env-gated placeholders that assert behavior the backend does not yet implement.
- `finalize-document` places every field with `x_pct * pageWidth` / `pageHeight - y_pct*h` and never reads `page.getRotation()`. On a 90/180 degree rotated page the flattened initials land in the wrong place. This is a real gap, not just a test gap.
- `finalize-document` has no idempotency guard: any repeat completion invoke re-renders and re-uploads the signed PDF (`upsert: true`), so a retried or delayed completion event redoes the flatten.
- Template send to recipients today is either "use template" (opens the editor, manual) or `bulk-send` (CSV upload, Business plan only). There is no email-only quick send.
- Signup plumbing is in place: the `on_auth_user_created` trigger on `auth.users` exists and `handle_new_user` inserts the profile. Whether new signups are blocked is an auth-setting question I could not read, so that is step 4.

## 1. Rotation-aware flattening

In `supabase/functions/finalize-document/index.ts`:

- Read `page.getRotation().angle` per page and normalize to 0/90/180/270.
- Compute field geometry in the page's visual (rotation-corrected) box, which is what the browser overlay measured, then map it back into unrotated PDF user space.
- Apply the same rotation angle to drawn text (`rotate: degrees(-angle)`) and to embedded signature/initials images so glyphs and marks read upright.
- Keep the current math untouched for `angle === 0` so existing envelopes are byte-comparable.

Certificate page stays unrotated.

## 2. Exactly-once signed PDF

- Add a `finalized_at timestamptz` and `finalize_lock_key` marker on `documents` (migration) so completion is claimable.
- `finalize-document` starts with a conditional claim: `update documents set finalized_at = now() where id = ? and finalized_at is null` returning rows. If no row comes back and `completed_file_path` is already set, return `{ success: true, path, idempotent: true }` without touching storage.
- Add an optional `force: true` body flag for deliberate re-finalize (used by admin re-issue only).
- `submit-signature` keeps invoking finalize; retried or delayed completion events now short-circuit.
- `payments-webhook`-style guard is not needed here, but the completion path gets an `audit_logs` entry noting `idempotent_skip` so retries are visible in the timeline.

## 3. Email-only template send

New "Send to recipients" flow on `/templates` (available on all plans, distinct from the Business CSV bulk send):

- Dialog takes a comma or newline separated list of email addresses, with inline validation and a per-address chip list.
- Calls a new `send-template` edge function that, per email: creates the document from the template, copies `template_fields` into `document_fields` with the percentage coordinates preserved and bound to the created signer, marks the document `sent`, and invokes `send-sign-request`.
- Initials fields carry over intact, so the recipient sees typed/drawn/uploaded initials options in the same field the template defined.
- Returns per-address success/failure so the UI can show which invites went out.

## 4. Account creation

- Confirm signup is enabled and that email confirmation behaves as intended; enable signup if it is off.
- Leave the existing `handle_new_user` trigger as is, since it already creates the profile row.
- Verify the welcome email fires for a fresh account (it is triggered from `useAuth` on `SIGNED_IN`).

## Technical notes

- Files touched: `supabase/functions/finalize-document/index.ts`, `supabase/functions/submit-signature/index.ts`, new `supabase/functions/send-template/index.ts`, `src/pages/Templates.tsx`, one migration for the finalize claim column.
- The existing rotated-page, template-placement, and retry/timeout specs become meaningful once 1-3 land; they stay env-gated so CI is unaffected.
- No change to storage layout or the download URLs.

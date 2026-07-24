## Goal
Tapping/clicking an Initials field on `/sign/:documentId` currently does nothing. Fix the click behavior, give initials their own focused dialog (not the "full legal name" signature one), and confirm the value flows through submission → finalized PDF.

## Diagnosis (unconfirmed; step 1 verifies)
The overlay button, `openFieldDialog`, and `confirmSignatureDialog` all appear to branch on `field.type === "initials"`, so on paper clicks should open the shared signature dialog. But the shared dialog is signature-shaped (asks for "Full legal name (first and last)"), and its content/labels/validation may be causing the dialog to feel "not opening" (e.g. autofocus jumping, or the shared state resetting when a signature was opened just before). We will:
1. Reproduce with Playwright against a seeded doc with one Initials field, capture screenshots + console logs.
2. Confirm whether `openFieldDialog` fires (add a temporary log; remove before shipping) and whether the Radix Dialog actually mounts.
3. Fix the real cause revealed by that repro.

## Changes

### 1. Dedicated Initials dialog (`src/pages/SignDocument.tsx`)
- Split the shared signature `Dialog` into two: keep the existing one for `signature`, add a new compact one for `initials` (own `initialsDialogFieldId` state).
- Initials dialog: title "Adopt your initials", one short input (max 4 chars, uppercased on change), same font/style pickers, live preview using `signatureFontSize(_, true)` so preview matches the flattened PDF, validation "Enter 1-4 initials".
- `openFieldDialog` routes `initials` to `setInitialsDialogFieldId(field.id)` instead of the signature dialog.
- Confirm handler writes to `fieldSignatures[id] = { method: "type", name, font }` exactly like today so downstream submit/finalize is unchanged.

### 2. Click reliability
- Keep `onClick`/`onPointerDown` on the overlay button, but drop the `type="button"` wrapper's reliance on `stopPropagation` from `onPointerDown` interfering with click on some mobile browsers: call `openFieldDialog` from `onPointerUp` when `pointerType !== "mouse"` to avoid the 300ms/scroll-cancel gap, mirroring how signature fields already work (this also fixes any regressions revealed by the repro).
- Ensure the initials overlay is not being covered by an adjacent field: no code change unless the repro shows overlap; if it does, add `pointer-events-auto` explicitly and bump z-index to `z-40` for the focused field.

### 3. Backend + finalizer sanity (no schema change)
- `submit-signature` already includes `initials` in `sigFields` and persists `signature_data` + `signature_font`; verify nothing here needs to change.
- `finalize-document` already draws initials with `signatureFontSize(h, true)`; verify the flattened PDF shows initials in the chosen font.

### 4. Test
Add `tests/e2e/initials-sign.spec.ts` using the existing `playwright-fixture.ts` pattern:
- Seed a document with 1 signature + 1 initials field for a single signer.
- Open the tokenized `/sign/...` link, click the initials overlay, expect the Initials dialog to appear (`getByRole("dialog", { name: /adopt your initials/i })`).
- Type "RB", adopt, expect overlay to show "RB" in the chosen font.
- Complete the signature field, submit, poll for `documents.status = completed`, download the finalized PDF, and assert (via `pdfjs-dist` text extract) that "RB" appears on the expected page. The phase is done only when this test passes.

## Files touched
- `src/pages/SignDocument.tsx` - split dialog, route initials, pointer-up trigger.
- `tests/e2e/initials-sign.spec.ts` - new e2e.

No DB migration, no edge-function API changes, no UI restructure outside the sign page.

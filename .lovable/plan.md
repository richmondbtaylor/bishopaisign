
## 1. Fix initials & checkbox on the sign page

Root cause found in `supabase/functions/submit-signature/index.ts` line 79:
```ts
const sigFields = allowedFields.filter((f: any) => f.type === "signature");
```
`initials` fields are excluded, so `signature_data` is never written for them. Downstream:
- `finalize-document` skips them (no `sig` present).
- Required-initials fields effectively vanish from the signed PDF.

For checkboxes: the UI never sends a value for unchecked boxes, so `document_fields.value` stays `NULL` and the flattener still draws an empty box (correct), but the audit trail can't tell "explicitly unchecked" from "never seen". Minor but worth fixing.

Changes:
- Include `initials` in the signature loop: `f.type === "signature" || f.type === "initials"`.
- In `SignDocument.tsx#finalSubmit`, ensure every checkbox field owned by the signer is sent (`"true"` or `"false"`), not only touched ones.
- Keep the existing `openFieldDialog` toggle behavior; no UI change beyond guaranteeing the payload.

## 2. Persist the chosen signature font on the envelope

Today `signature_data.font` is stored per field, but the "adopted" font is not remembered across fields or re-signings, so re-downloads can drift if a field is re-flattened without a font.

Changes:
- Add `signature_font TEXT` column to `document_signers` (nullable, defaults NULL).
- On first signature adoption in `submit-signature`, write the chosen `font` back to `document_signers.signature_font`.
- In `finalize-document`, resolution order for each signature/initials field:
  1. `signature_data.font` (per field)
  2. `document_signers.signature_font` (envelope-level fallback)
  3. `'Dancing Script', cursive` (default)
- Applies to typed sigs; drawn/uploaded already embed a raster and are font-agnostic.

## 3. Unify audit PDF with signed PDF rendering

`download-audit-pdf` currently builds a plain Helvetica certificate from scratch, so it visually diverges from the flattened signed PDF.

Changes:
- If `documents.completed_file_path` exists, load that PDF, copy its pages into the audit output first, then append the "Certificate of Audit Trail" pages.
- Reuse the same `FONT_SOURCES` map and font-loading helper from `finalize-document` (move to `supabase/functions/_shared/signature-fonts.ts` and import from both).
- Certificate pages continue to use Helvetica, but any signer-name summary that displays a signature preview uses the signer's `signature_font`, so the audit trail matches the signed doc.

## 4. Pixel-accurate parity between DocumentView preview and downloaded PDF

Preview in `DocumentView` and `SignDocument` uses:
```
fontSize: height * (initials ? 0.85 : 0.7)
```
Finalizer uses:
```
size = min(h * (initials ? 0.9 : 0.85), 24|28)
```
These drift on tall fields.

Changes:
- Extract a shared helper `signatureFontSize(heightPx, isInitials)` in `src/lib/signature-render.ts` with the exact formula the finalizer uses (`min(h * 0.85, 28)` / `min(h * 0.9, 24)`).
- Use it in `SignDocument.tsx` and `DocumentView.tsx` overlay rendering so preview visually matches the flattened output.
- Add a Playwright pixel-diff test (`tests/e2e/signature-parity.spec.ts`):
  1. Seed a doc with one typed signature per script/serif/mono font.
  2. Screenshot the DocumentView overlay for each field.
  3. Rasterize the signed PDF page (via `pdfjs-dist` in the test) and crop the same field bbox.
  4. Assert per-pixel diff under a small threshold (`pixelmatch`, tolerance ~5%).

## 5. Regression coverage for typed / drawn / uploaded across re-downloads

Add `tests/e2e/signature-methods.spec.ts`:
- For each method (type, draw, upload) sign the document, download the signed PDF twice with a re-finalize in between, and assert:
  - PDF byte length > baseline
  - Rasterized field bbox is non-empty
  - Typed variant: OCR (`tesseract.js`) finds the signer's name; drawn/uploaded: image histogram matches the source within tolerance.

## Technical section

Files touched:
- `supabase/functions/submit-signature/index.ts` (+ include initials, persist font)
- `supabase/functions/finalize-document/index.ts` (font fallback chain, import shared font map)
- `supabase/functions/download-audit-pdf/index.ts` (merge signed PDF pages, shared fonts)
- `supabase/functions/_shared/signature-fonts.ts` (new)
- `src/lib/signature-render.ts` (new shared sizing helper)
- `src/pages/SignDocument.tsx` (use helper, send full checkbox payload)
- `src/pages/DocumentView.tsx` (use helper for preview parity)
- Migration: `ALTER TABLE document_signers ADD COLUMN signature_font TEXT;`
- Tests: `tests/e2e/signature-parity.spec.ts`, `tests/e2e/signature-methods.spec.ts`

No user-facing UI restructure. All backend edge functions retain existing endpoints and payloads (additive only).

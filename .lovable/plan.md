## Product change

Remove the dashboard PIN gate:
- `src/App.tsx`: drop the `PinGate` import and unwrap `<Dashboard />` so `/dashboard` is protected by auth only.
- Delete `src/components/PinGate.tsx`.
- No other route uses it, so nothing else changes.

## New e2e specs

All specs stay env-gated with `test.skip(...)` like the rest of the suite, so CI stays green without live envelopes.

1. `tests/e2e/completion-retry-timeouts.spec.ts`
   - Sign an envelope with initials, wait for `completed`.
   - Simulate webhook delivery retries: fire the same completion event repeatedly, including bursts sent in parallel and one delivery aborted mid-flight (client-side abort/timeout) then retried.
   - Assert status stays `completed` (never regresses), each delivery returns non-5xx, and the download is a single valid `%PDF` containing the entered initials.
   - Assert "exactly one" output by comparing byte length and extracted text across downloads before and after the retry storm; the flattened PDF must not gain duplicate initials occurrences.
   - Uses `fireCompletionEvent`, `pollDocumentStatus`, `fetchPdfWithRetry`, `extractPdfText`.

2. `tests/e2e/initials-rotated-pages.spec.ts`
   - Env: `TEST_SIGN_URL_ROTATED` (envelope whose PDF has 90/180 degree rotated pages) plus `TEST_DOWNLOAD_URL_ROTATED`.
   - Draw initials on the rotated page, record the on-screen overlay rect normalized to the rendered page box (`initialsOverlayRect`).
   - Download, rasterize the page, and assert ink is present in the recorded rect and materially higher than in a control region, so rotation is not dropped or double-applied.
   - Re-download and assert the ink ratio matches within a tight tolerance.

3. `tests/e2e/initials-mixed-methods.spec.ts`
   - Three signers on one envelope: signer A typed initials (`signInitialsFlow`), signer B drawn (`drawInitialsFlow`), signer C uploaded PNG (`uploadInitialsFlow` with a runtime fixture from `writeInitialsPngFixture`).
   - After all three, assert the typed initials text is extractable, and the drawn plus uploaded marks show as ink in their recorded regions.
   - Assert the number of embedded image XObjects matches the two image-based signers via `extractImageXObjectOrder`.
   - Re-download and assert text and ink ratios are unchanged.

4. `tests/e2e/template-initials-placement.spec.ts`
   - Env: `TEST_TEMPLATE_SIGN_URL` / `TEST_TEMPLATE_DOWNLOAD_URL` for an envelope created from a template that carries pre-placed initials fields.
   - Sign with drawn initials (and an uploaded variant when `TEST_TEMPLATE_UPLOAD=1`), record the overlay rect, and assert the downloaded PDF places ink in the same normalized region the template defined.
   - Re-download and assert placement is stable.

## Shared helper additions (`tests/e2e/helpers/initials.ts`)

- `fireCompletionEventWithTimeout(...)` - a delivery that aborts after N ms, for the retry/timeout spec.
- `countOccurrences(text, needle)` - duplicate-initials check.
- `countImageXObjects(bytes)` - thin wrapper over the existing XObject scan.
- `signerRegionRect(page, testId)` - overlay rect for a specific field, used by the mixed-methods and template specs.

## Notes

- No backend or edge-function changes; existing finalize and completion paths already cover all three initials methods.
- Raster assertions self-skip when `node-canvas` is unavailable, matching the existing specs.

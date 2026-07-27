## Goal

Four new Playwright e2e specs for initials, plus the one small product change they depend on.

## Product change required first

The initials dialog on the signing page currently supports Type and Draw only. There is no upload option, so the "uploaded signature image for initials" test has nothing to drive. Add a third tab:

- `src/pages/SignDocument.tsx`: add an "Upload" mode to the initials dialog alongside Type/Draw. A hidden file input accepts PNG/JPG, reads it as a data URL, shows a preview, and adopts it as `{ method: "draw", name: initials, image: dataUrl }` so the existing overlay rendering, submit payload, and `finalize-document` image embedding all work unchanged.
- Test hooks: `data-testid="initials-mode-upload"`, `initials-upload-input`, `initials-upload-preview`.
- Basic validation: reject non-image types and files over ~2MB with an inline message.

There is also no in-app zoom control on the signing page, so the zoom test will vary browser zoom instead (see below).

## New specs

1. `tests/e2e/initials-drawn-zoom.spec.ts`
   - For each zoom level (0.75, 1.0, 1.5) applied via `deviceScaleFactor` plus a CSS page zoom on the document root, draw initials on the canvas, record the on-screen overlay rect normalized against the rendered PDF page rect, and submit.
   - Download the signed PDF, rasterize page 1, and assert the inked region matching the initials overlay sits within a 2% normalized tolerance of the recorded on-screen rect.
   - Re-download and assert the same alignment, so zoom at capture time never leaks into the flattened output.
   - Reuses `renderPdfPageToPng`, `cropRegion`, `inkRatio` from `tests/e2e/helpers/initials.ts`.

2. `tests/e2e/completion-event-idempotency.spec.ts`
   - Sign an envelope with initials, then simulate webhook/completion churn: fire the completion notification path repeatedly, including a stale (out-of-order) event replayed after a newer one.
   - Assert the document reaches `completed` exactly once (status stays `completed`, no revert), the signed-PDF download stays a valid `%PDF`, and the entered initials are present on both the first and a later re-download.
   - Duplicate/out-of-order delivery is driven from the test via repeated calls to the completion endpoint; helper additions go in `helpers/initials.ts`.

3. `tests/e2e/initials-drawn-sequential.spec.ts`
   - Same shape as the existing `initials-sequential-ordering.spec.ts` but using `drawInitialsFlow` for both signers.
   - Baseline: neither mark present. After signer A: A's drawn mark present in the expected page region, signer B's region still blank. After signer B: both present.
   - Because drawn marks carry no extractable text, ordering is asserted on page-region ink presence plus the order of embedded image XObjects in the PDF, and re-download must preserve both.

4. `tests/e2e/initials-uploaded-image.spec.ts`
   - Generate a small PNG fixture at runtime, set it on the upload input in the initials dialog, adopt, complete the remaining fields and submit.
   - Assert the downloaded signed PDF renders ink in the initials region and that the ink pattern is stable across a re-download.

## Shared helper additions (`tests/e2e/helpers/initials.ts`)

- `uploadInitialsFlow(page, { filePath, signerName })`
- `drawInitialsAtZoom(page, { zoom })` returning the captured normalized overlay rect
- `pollDocumentStatus` / `fireCompletionEvent` used by the idempotency spec
- `extractImageXObjectOrder(bytes)` for drawn-mark ordering

## Notes

- All specs stay env-gated with `test.skip(...)` like the existing suite (`TEST_SIGN_URL`, `TEST_DOWNLOAD_URL`, etc.), so CI stays green without live envelopes.
- No backend changes: `finalize-document` already embeds PNG/JPG data URLs for `method: "draw"`.

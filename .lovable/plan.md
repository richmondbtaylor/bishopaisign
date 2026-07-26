## Goal

Add drawn-initials support to the signing page, then extend Playwright e2e coverage with four items: drawn initials, a cross-browser CI matrix, a send-and-wait-for-completion download test, and a parallel two-signer initials test.

## 1. Product change: Draw tab in the initials dialog

`src/pages/SignDocument.tsx` currently opens a typed-only "Adopt your initials" dialog for `initials` fields. Add a mode toggle inside that dialog, mirroring the existing signature dialog's draw canvas:

- Tabs: "Type" (existing UI) and "Draw" (canvas with pointer/touch drawing, Clear button).
- Draw mode stores `{ method: "draw", dataUrl, name: <typed fallback initials> }` into `fieldSignatures`, matching the shape the signature dialog already produces so `submit-signature` and `finalize-document` need no changes.
- Validation: Adopt disabled until the canvas has strokes; typed mode keeps the 1-4 character rule.
- Overlay renders the drawn image scaled into the field box, same as drawn signatures.
- Add `data-testid` hooks: `initials-mode-draw`, `initials-canvas`, `initials-adopt`.

Because a drawn mark carries no extractable text, the PDF assertion for drawn initials is image-based, not text-based (see test 1).

## 2. New / updated tests (all under `tests/e2e/`)

**a. `initials-drawn.spec.ts` (new)**
- Env: `TEST_SIGN_URL`, `TEST_DOWNLOAD_URL`; skips when unset.
- Opens the initials field, switches to Draw, strokes the canvas via `page.mouse` moves, adopts, completes signing.
- Downloads the signed PDF twice via the shared `fetchPdfWithRetry` helper.
- Assertions per download: valid `%PDF`, and the initials field region on the rendered page is non-blank (render page to PNG with `pdfjs` + `canvas`, crop the field bbox, assert ink pixel ratio above a floor). Both downloads produce a matching crop within the existing pixelmatch tolerance, proving stability across re-download.
- Reuses/extends helpers in `tests/e2e/helpers/initials.ts` (`drawInitialsFlow`, plus a `renderPdfPageToPng` + `cropRegion` pair factored out of `initials-pixel-placement.spec.ts`).

**b. `initials-completion-download.spec.ts` (new)**
- Env: `TEST_SIGN_URL`, `TEST_DOWNLOAD_URL`, `TEST_DOCUMENT_ID`, `TEST_INITIALS`.
- Signs with typed initials, then polls the backend document row (anon REST read of `documents.status` for the id, retried with backoff) until status is `completed` or the poll budget expires.
- Only after the completion signal does it download the signed PDF; asserts `%PDF` and that extracted text contains the initials, then re-downloads and re-asserts.
- Named "waits for the completion event" in the spec title; the polling helper is written so it can be swapped for a real outbound webhook receiver later without touching the assertions.

**c. `initials-parallel-signers.spec.ts` (new)**
- Env: `TEST_SIGN_URL_A`, `TEST_SIGN_URL_B`, `TEST_DOWNLOAD_URL`, optional `TEST_INITIALS_A` / `TEST_INITIALS_B`.
- Two isolated browser contexts sign concurrently with `Promise.all` (true parallel mode, no ordering wait).
- Immediately after both completions, downloads once and asserts both initials strings are present with no long settle delay (short retry budget, so a slow merge fails the test).
- Re-downloads twice more and asserts both initials persist each time.
- Distinct from `initials-multi-signer.spec.ts`, which is workflow-switchable and tolerant of long settling; this one pins the strict parallel contract.

## 3. CI workflow matrix

Update `.github/workflows/e2e.yml`:
- Add `strategy: fail-fast: false, matrix: browser: [chromium, firefox, webkit]`.
- Job name becomes `e2e (${{ matrix.browser }})`.
- `npx playwright install --with-deps ${{ matrix.browser }}`.
- Run `npx playwright test --project=${{ matrix.browser }} --reporter=list,html`.
- Artifact names suffixed with the browser (`playwright-report-${{ matrix.browser }}-${{ github.run_attempt }}` and the same for failure artifacts) so uploads do not collide.
- `playwright.config.ts`: add explicit `projects` for chromium, firefox, and webkit using the Playwright device descriptors, layered on top of `createLovableConfig`.

## Technical notes

- No backend or edge-function changes; the drawn-initials payload reuses the existing drawn-signature path.
- New tests stay env-gated and self-skip locally, matching current conventions.
- Pixel helpers reuse the already-installed `pixelmatch`, `pngjs`, and `canvas` devDependencies.

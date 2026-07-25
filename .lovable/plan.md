## Goal

Expand Playwright e2e coverage around initials so we prove they survive network flakiness, multi-signer flows, font choice, pixel placement, and the audit-PDF download path.

## New / updated test files

All under `tests/e2e/`, following the existing `initials-sign.spec.ts` conventions (env-driven URLs, `pdfjs-dist/legacy` for text extraction, `test.skip` when env is missing).

1. `tests/e2e/initials-sign.spec.ts` (extend)
   - Add a new test case: "signed PDF download is stable under transient network failure".
   - Use `page.route(DOWNLOAD_URL, ...)` to fail the first N requests with `route.abort("failed")` / 503, then let it succeed.
   - Wrap the existing `fetchSignedPdf` helper with a retry loop (exponential backoff, max 5 tries) and assert:
     - Final response is a real `%PDF` buffer.
     - Extracted text still contains `INITIALS`.
   - Assert retry count > 0 so we know the flake was actually exercised.

2. `tests/e2e/initials-multi-signer.spec.ts` (new)
   - Env: `TEST_SIGN_URL_A`, `TEST_SIGN_URL_B`, `TEST_DOWNLOAD_URL`, `TEST_INITIALS_A` (default `AA`), `TEST_INITIALS_B` (default `BB`), `TEST_WORKFLOW` (`sequential` | `parallel`).
   - Two describe blocks, one per workflow; skip when env missing.
   - Sequential: sign as A, wait for "waiting on next signer" state, then sign as B using URL delivered/known via env.
   - Parallel: sign as A and B in two browser contexts concurrently.
   - After completion, download signed PDF twice and assert both `INITIALS_A` and `INITIALS_B` appear in extracted text on each download.

3. `tests/e2e/initials-font.spec.ts` (new)
   - Env: `TEST_SIGN_URL`, `TEST_DOWNLOAD_URL`, `TEST_INITIALS`, `TEST_FONT_LABEL` (matches a label in the initials dialog font picker, e.g. `Great Vibes`).
   - Open initials dialog, select the specified font via `getByRole("button" | "radio", { name: TEST_FONT_LABEL })`, adopt, submit.
   - Download signed PDF, then re-download.
   - Assertions on each download:
     - Extracted text contains `INITIALS`.
     - The embedded font list (parsed via `pdfjs` `page.getOperatorList()` / `commonObjs`) contains the expected font family key from `FONT_SOURCES` (map label → key inline in the test).
   - Confirms font choice persists across re-downloads.

4. `tests/e2e/initials-pixel-placement.spec.ts` (new)
   - After signing (reuse helper extracted from `initials-sign.spec.ts`), before submitting take an element screenshot of the initials overlay and record its bounding rect + page dimensions from the react-pdf canvas.
   - After completion, download signed PDF; render page 1 to PNG at the same DPR using `pdfjs` + `node-canvas` (add as devDep) at a scale that matches the on-screen canvas width.
   - Crop the rendered PDF page to the same bounding rect (converted via `x_pct/y_pct/w_pct/h_pct` from the field row fetched by a small helper hitting the anon `documents`/`document_fields` endpoint, or by re-reading `data-field-overlay` attributes).
   - Use `pixelmatch` (add as devDep) to diff the on-screen overlay crop vs the rendered PDF crop; assert mismatched pixel ratio < a tolerance (start at 5%). Save diff artifact to `test-results/` on failure.

5. `tests/e2e/audit-pdf-initials.spec.ts` (new)
   - Env: `TEST_SIGN_URL`, `TEST_AUDIT_DOWNLOAD_URL` (points to `download-audit-pdf` endpoint for the same document, with auth header supplied via `TEST_AUDIT_BEARER`), `TEST_INITIALS`.
   - Sign the envelope (reuse helper).
   - Fetch audit PDF twice with `Authorization: Bearer $TEST_AUDIT_BEARER`, using the same retry helper as test 1.
   - Assert both downloads:
     - Are valid `%PDF` buffers.
     - Contain `INITIALS` in extracted text (the merged signed pages carry the flattened initials).

## Shared helpers

Extract into `tests/e2e/helpers/initials.ts`:
- `extractPdfText(bytes)` (moved from existing spec).
- `fetchPdfWithRetry(url, { init?, maxAttempts, pollMs })` returning `{ buffer, attempts }`.
- `signInitialsFlow(page, { initials, signerName? })` performing the dialog interaction and submit.

Update `initials-sign.spec.ts` to import from the helper so all specs share one implementation.

## Dev dependencies to add (build phase)

- `pixelmatch`, `pngjs`, `canvas` (for pdfjs node rendering in the pixel test).

## Out of scope

- No product code changes; all edits live under `tests/` and `package.json` devDependencies.
- No CI wiring changes; tests remain env-gated and skip locally without the env vars, matching the existing pattern.

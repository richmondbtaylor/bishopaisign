/**
 * Playwright e2e: mixed initials methods across three signers on the same
 * envelope. Signer A types initials, signer B draws them, signer C uploads a
 * signature image. All three must render in the downloaded PDF and stay
 * aligned across re-downloads.
 *
 * Required env:
 *   TEST_SIGN_URL_A   Signing link for signer A (typed initials)
 *   TEST_SIGN_URL_B   Signing link for signer B (drawn initials)
 *   TEST_SIGN_URL_C   Signing link for signer C (uploaded image initials)
 *   TEST_DOWNLOAD_URL Signed-PDF download URL
 *
 * Optional env:
 *   TEST_INITIALS_A / _B / _C   Default "AA" / "BB" / "CC"
 */
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  completeRemainingFields,
  controlRect,
  countImageXObjects,
  extractPdfText,
  fetchPdfWithRetry,
  initialsOverlayRect,
  inkRatioInRect,
  padRect,
  signInitialsFlow,
  uploadInitialsFlow,
  waitForCompletion,
  writeInitialsPngFixture,
  type NormalizedRect,
} from "./helpers/initials";

const SIGN_URL_A = process.env.TEST_SIGN_URL_A;
const SIGN_URL_B = process.env.TEST_SIGN_URL_B;
const SIGN_URL_C = process.env.TEST_SIGN_URL_C;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const INITIALS_A = (process.env.TEST_INITIALS_A || "AA").toUpperCase().slice(0, 4);
const INITIALS_B = (process.env.TEST_INITIALS_B || "BB").toUpperCase().slice(0, 4);
const INITIALS_C = (process.env.TEST_INITIALS_C || "CC").toUpperCase().slice(0, 4);

test.describe("Mixed initials methods across three signers", () => {
  test.skip(
    !SIGN_URL_A || !SIGN_URL_B || !SIGN_URL_C || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL_A, TEST_SIGN_URL_B, TEST_SIGN_URL_C and TEST_DOWNLOAD_URL to run.",
  );

  test("typed, drawn and uploaded initials all render and stay aligned", async ({
    browser,
  }) => {
    test.setTimeout(480_000);

    // Signer A: typed initials.
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto(SIGN_URL_A!, { waitUntil: "networkidle" });
    await signInitialsFlow(pageA, { initials: INITIALS_A, signerName: "Signer A" });
    await waitForCompletion(pageA);
    await ctxA.close();

    // Signer B: drawn initials. Record the overlay rect before submitting.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto(SIGN_URL_B!, { waitUntil: "networkidle" });
    const rectB = await drawAndAdopt(pageB, INITIALS_B);
    await completeRemainingFields(pageB, "Signer B");
    await waitForCompletion(pageB);
    await ctxB.close();

    // Signer C: uploaded image initials.
    const fixture = await writeInitialsPngFixture(
      path.join("test-results", "fixtures", "mixed-initials.png"),
    );
    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await pageC.goto(SIGN_URL_C!, { waitUntil: "networkidle" });

    // Open the dialog once to measure the target region, then close and upload.
    const rectC = await measureInitialsRegion(pageC);
    await uploadInitialsFlow(pageC, {
      filePath: fixture,
      initials: INITIALS_C,
      signerName: "Signer C",
    });
    await waitForCompletion(pageC);
    await ctxC.close();

    const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 14,
      pollMs: 2500,
    });
    expect(first.buffer.slice(0, 4).toString()).toBe("%PDF");

    // Typed initials are extractable as text.
    const text = await extractPdfText(first.buffer);
    expect(text, "typed initials for signer A").toContain(INITIALS_A);

    // Drawn and uploaded marks are embedded as images.
    expect(
      countImageXObjects(first.buffer),
      "drawn and uploaded marks should be embedded as images",
    ).toBeGreaterThanOrEqual(2);

    const targetB = padRect(rectB);
    const targetC = padRect(rectC);

    const inkB1 = await inkRatioInRect(first.buffer, targetB);
    test.skip(inkB1 === null, "node-canvas unavailable, skipping raster assertions");
    const inkC1 = await inkRatioInRect(first.buffer, targetC);

    expect(inkB1!, "drawn initials ink for signer B").toBeGreaterThan(0.005);
    expect(inkC1!, "uploaded initials ink for signer C").toBeGreaterThan(0.005);

    const ctrl = await inkRatioInRect(first.buffer, controlRect(targetB));
    expect(inkB1!).toBeGreaterThan(ctrl!);

    // Re-download: text and both ink regions unchanged.
    const second = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    expect(await extractPdfText(second.buffer)).toContain(INITIALS_A);
    const inkB2 = await inkRatioInRect(second.buffer, targetB);
    const inkC2 = await inkRatioInRect(second.buffer, targetC);
    expect(Math.abs(inkB2! - inkB1!)).toBeLessThan(0.02);
    expect(Math.abs(inkC2! - inkC1!)).toBeLessThan(0.02);
  });
});

/** Draw initials, adopt, and return the normalized overlay rect. */
async function drawAndAdopt(
  page: import("@playwright/test").Page,
  initials: string,
): Promise<NormalizedRect> {
  const initialsBtn = page
    .getByRole("button", { name: /click for initials|initials/i })
    .first();
  await expect(initialsBtn).toBeVisible({ timeout: 20_000 });
  await initialsBtn.click();

  const dialog = page.getByRole("dialog", { name: /adopt your initials/i });
  await expect(dialog).toBeVisible();

  const input = dialog.getByRole("textbox").first();
  if (await input.count()) await input.fill(initials);

  await dialog.getByTestId("initials-mode-draw").click();
  const canvas = dialog.getByTestId("initials-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("initials canvas has no bounding box");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.25, { steps: 12 });
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7, { steps: 12 });
  await page.mouse.up();

  const adopt = dialog.getByTestId("initials-adopt");
  await expect(adopt).toBeEnabled();
  await adopt.click();
  await expect(dialog).toBeHidden();

  return initialsOverlayRect(page);
}

/** Measure the initials field region before it is filled. */
async function measureInitialsRegion(
  page: import("@playwright/test").Page,
): Promise<NormalizedRect> {
  await expect(
    page.locator('[data-field-overlay="true"]').first(),
  ).toBeVisible({ timeout: 20_000 });
  return initialsOverlayRect(page);
}

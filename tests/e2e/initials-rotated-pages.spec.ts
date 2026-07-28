/**
 * Playwright e2e: drawn initials on a PDF with rotated pages (90/180 degrees).
 * The overlay position captured on screen must match the flattened output, and
 * that alignment must survive a re-download (rotation applied once, not twice).
 *
 * Required env:
 *   TEST_SIGN_URL_ROTATED     Signing link for an envelope whose PDF has rotated pages
 *   TEST_DOWNLOAD_URL_ROTATED Signed-PDF download URL for that envelope
 *
 * Optional env:
 *   TEST_ROTATED_PAGE   1-based page number to inspect, default 1
 *   TEST_SIGNER_NAME    Defaults to "Rotation Signer"
 */
import { test, expect } from "@playwright/test";
import {
  completeRemainingFields,
  controlRect,
  drawInitialsFlow,
  fetchPdfWithRetry,
  initialsOverlayRect,
  inkRatioInRect,
  padRect,
  waitForCompletion,
} from "./helpers/initials";

const SIGN_URL = process.env.TEST_SIGN_URL_ROTATED;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL_ROTATED;
const PAGE_NUMBER = Number(process.env.TEST_ROTATED_PAGE || 1);
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Rotation Signer";

test.describe("Drawn initials on rotated pages", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL_ROTATED and TEST_DOWNLOAD_URL_ROTATED to run.",
  );

  test("rotated pages keep the initials overlay aligned across re-downloads", async ({
    page,
  }) => {
    test.setTimeout(360_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });

    // Draw the initials, then record where the overlay sits relative to the
    // rendered (already rotation-corrected) page box.
    await drawInitialsFlowWithoutSubmit(page);
    const rect = await initialsOverlayRect(page);
    expect(rect.w).toBeGreaterThan(0);
    expect(rect.h).toBeGreaterThan(0);

    await completeRemainingFields(page, SIGNER_NAME);
    await waitForCompletion(page);

    const target = padRect(rect);
    const control = controlRect(target);

    const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 12,
      pollMs: 2500,
    });
    expect(first.buffer.slice(0, 4).toString()).toBe("%PDF");

    const inkFirst = await inkRatioInRect(first.buffer, target, PAGE_NUMBER);
    test.skip(inkFirst === null, "node-canvas unavailable, skipping raster assertions");

    expect(inkFirst!, "initials ink on the rotated page").toBeGreaterThan(0.005);

    const inkControl = await inkRatioInRect(first.buffer, control, PAGE_NUMBER);
    expect(
      inkFirst!,
      "initials region must be inkier than an unrelated region (rotation not mis-applied)",
    ).toBeGreaterThan(inkControl!);

    const second = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    const inkSecond = await inkRatioInRect(second.buffer, target, PAGE_NUMBER);
    expect(
      Math.abs(inkSecond! - inkFirst!),
      "re-download must preserve the rotated placement",
    ).toBeLessThan(0.02);
  });
});

/** Draw initials and adopt them without submitting the envelope yet. */
async function drawInitialsFlowWithoutSubmit(page: import("@playwright/test").Page) {
  const initialsBtn = page
    .getByRole("button", { name: /click for initials|initials/i })
    .first();
  await expect(initialsBtn).toBeVisible({ timeout: 20_000 });
  await initialsBtn.click();

  const dialog = page.getByRole("dialog", { name: /adopt your initials/i });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("initials-mode-draw").click();

  const canvas = dialog.getByTestId("initials-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("initials canvas has no bounding box");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.25, { steps: 12 });
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.75, { steps: 12 });
  await page.mouse.up();

  const adopt = dialog.getByTestId("initials-adopt");
  await expect(adopt).toBeEnabled();
  await adopt.click();
  await expect(dialog).toBeHidden();
}

// Keep the shared drawn flow referenced so the import stays meaningful for
// envelopes that need the full submit path.
void drawInitialsFlow;

/**
 * Playwright e2e: an envelope created from a template that carries pre-placed
 * initials fields. Signing with drawn (or uploaded) initials must land in the
 * region the template defined, and that placement must survive re-downloads.
 *
 * Required env:
 *   TEST_TEMPLATE_SIGN_URL     Signing link for an envelope sent from a template
 *   TEST_TEMPLATE_DOWNLOAD_URL Signed-PDF download URL for that envelope
 *
 * Optional env:
 *   TEST_TEMPLATE_UPLOAD  "1" to use an uploaded image instead of a drawn mark
 *   TEST_TEMPLATE_PAGE    1-based page number to inspect, default 1
 *   TEST_SIGNER_NAME      Defaults to "Template Recipient"
 */
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  completeRemainingFields,
  controlRect,
  fetchPdfWithRetry,
  initialsOverlayRect,
  inkRatioInRect,
  padRect,
  uploadInitialsFlow,
  waitForCompletion,
  writeInitialsPngFixture,
} from "./helpers/initials";

const SIGN_URL = process.env.TEST_TEMPLATE_SIGN_URL;
const DOWNLOAD_URL = process.env.TEST_TEMPLATE_DOWNLOAD_URL;
const USE_UPLOAD = process.env.TEST_TEMPLATE_UPLOAD === "1";
const PAGE_NUMBER = Number(process.env.TEST_TEMPLATE_PAGE || 1);
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Template Recipient";

test.describe("Template initials placement", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL,
    "Set TEST_TEMPLATE_SIGN_URL and TEST_TEMPLATE_DOWNLOAD_URL to run.",
  );

  test("template initials fields keep their placement for new recipients", async ({
    page,
  }) => {
    test.setTimeout(360_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });

    // The template defines where the initials field sits. Measure it before
    // filling anything so the assertion is against the template geometry.
    await expect(
      page.locator('[data-field-overlay="true"]').first(),
    ).toBeVisible({ timeout: 20_000 });
    const templateRect = await initialsOverlayRect(page);
    expect(templateRect.w).toBeGreaterThan(0);
    expect(templateRect.h).toBeGreaterThan(0);

    if (USE_UPLOAD) {
      const fixture = await writeInitialsPngFixture(
        path.join("test-results", "fixtures", "template-initials.png"),
      );
      await uploadInitialsFlow(page, { filePath: fixture, signerName: SIGNER_NAME });
    } else {
      await drawAndAdopt(page);
      await completeRemainingFields(page, SIGNER_NAME);
    }
    await waitForCompletion(page);

    const target = padRect(templateRect);
    const control = controlRect(target);

    const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 12,
      pollMs: 2500,
    });
    expect(first.buffer.slice(0, 4).toString()).toBe("%PDF");

    const inkFirst = await inkRatioInRect(first.buffer, target, PAGE_NUMBER);
    test.skip(inkFirst === null, "node-canvas unavailable, skipping raster assertions");

    expect(
      inkFirst!,
      "initials should render inside the template-defined region",
    ).toBeGreaterThan(0.005);

    const inkControl = await inkRatioInRect(first.buffer, control, PAGE_NUMBER);
    expect(inkFirst!).toBeGreaterThan(inkControl!);

    const second = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    const inkSecond = await inkRatioInRect(second.buffer, target, PAGE_NUMBER);
    expect(
      Math.abs(inkSecond! - inkFirst!),
      "re-download must preserve template placement",
    ).toBeLessThan(0.02);
  });
});

/** Draw initials in the dialog and adopt them (no submit). */
async function drawAndAdopt(page: import("@playwright/test").Page) {
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
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.25, { steps: 12 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.7, { steps: 12 });
  await page.mouse.up();

  const adopt = dialog.getByTestId("initials-adopt");
  await expect(adopt).toBeEnabled();
  await adopt.click();
  await expect(dialog).toBeHidden();
}

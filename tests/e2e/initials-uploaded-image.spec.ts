/**
 * Playwright e2e: adopt initials from an uploaded image, complete signing, and
 * verify the mark renders in the downloaded PDF across re-downloads.
 *
 * Required env:
 *   TEST_SIGN_URL      Tokenized signing link containing an initials field
 *   TEST_DOWNLOAD_URL  Signed-PDF download URL
 *
 * Optional env:
 *   TEST_SIGNER_NAME   Defaults to "Upload Signer"
 */
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  extractImageXObjectOrder,
  fetchPdfWithRetry,
  initialsOverlayRect,
  inkRatioInRect,
  uploadInitialsFlow,
  waitForCompletion,
  writeInitialsPngFixture,
} from "./helpers/initials";

const SIGN_URL = process.env.TEST_SIGN_URL;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Upload Signer";

test.describe("Uploaded initials image", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL and TEST_DOWNLOAD_URL to run.",
  );

  test("uploaded initials image renders in the signed PDF and survives re-download", async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

    const fixture = await writeInitialsPngFixture(
      path.join(testInfo.outputDir, "initials-upload.png"),
    );

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });

    await uploadInitialsFlow(page, {
      filePath: fixture,
      initials: "UP",
      signerName: SIGNER_NAME,
    });

    // Record on-screen placement before the completion screen replaces it.
    let rect: { x: number; y: number; w: number; h: number } | null = null;
    try {
      rect = await initialsOverlayRect(page);
    } catch {
      rect = null;
    }

    await waitForCompletion(page);

    const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 12,
      pollMs: 2500,
    });
    expect(first.buffer.slice(0, 4).toString()).toBe("%PDF");
    expect(
      extractImageXObjectOrder(first.buffer).length,
      "uploaded initials image should be embedded",
    ).toBeGreaterThan(0);

    const region = rect
      ? {
          x: Math.max(0, rect.x - 0.02),
          y: Math.max(0, rect.y - 0.02),
          w: Math.min(1, rect.w + 0.04),
          h: Math.min(1, rect.h + 0.04),
        }
      : { x: 0, y: 0, w: 1, h: 1 };

    const inkFirst = await inkRatioInRect(first.buffer, region);
    test.skip(inkFirst === null, "node-canvas unavailable, skipping raster assertions");
    expect(inkFirst!).toBeGreaterThan(0.005);

    const second = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    expect(second.buffer.slice(0, 4).toString()).toBe("%PDF");
    expect(extractImageXObjectOrder(second.buffer).length).toBe(
      extractImageXObjectOrder(first.buffer).length,
    );
    const inkSecond = await inkRatioInRect(second.buffer, region);
    expect(Math.abs(inkSecond! - inkFirst!)).toBeLessThan(0.02);
  });
});

/**
 * Playwright e2e: drawn initials captured at different zoom levels must land
 * in the same normalized position in the downloaded signed PDF, and that
 * placement must survive a re-download.
 *
 * Required env:
 *   TEST_SIGN_URL      Tokenized signing link containing an initials field
 *   TEST_DOWNLOAD_URL  Signed-PDF download URL
 *
 * Optional env:
 *   TEST_ZOOM_LEVELS   Comma-separated zoom factors, default "0.75,1,1.5"
 *   TEST_SIGNER_NAME   Defaults to "Zoom Signer"
 */
import { test, expect } from "@playwright/test";
import {
  drawInitialsAtZoom,
  fetchPdfWithRetry,
  inkRatioInRect,
  waitForCompletion,
} from "./helpers/initials";

const SIGN_URL = process.env.TEST_SIGN_URL;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Zoom Signer";
const ZOOMS = (process.env.TEST_ZOOM_LEVELS || "0.75,1,1.5")
  .split(",")
  .map((z) => Number(z.trim()))
  .filter((z) => Number.isFinite(z) && z > 0);

test.describe("Drawn initials across zoom levels", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL and TEST_DOWNLOAD_URL to run.",
  );

  for (const zoom of ZOOMS) {
    test(`zoom ${zoom}x keeps the initials overlay aligned across re-downloads`, async ({
      page,
    }) => {
      test.setTimeout(300_000);

      await page.goto(SIGN_URL!, { waitUntil: "networkidle" });

      // Draw at this zoom level and record where the overlay sits on screen,
      // normalized against the rendered page box.
      const rect = await drawInitialsAtZoom(page, zoom);
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);

      const { completeRemainingFields } = await import("./helpers/initials");
      await completeRemainingFields(page, SIGNER_NAME);
      await waitForCompletion(page);

      // Slightly padded crop so anti-aliasing at the edges does not matter.
      const pad = 0.02;
      const target = {
        x: Math.max(0, rect.x - pad),
        y: Math.max(0, rect.y - pad),
        w: Math.min(1, rect.w + pad * 2),
        h: Math.min(1, rect.h + pad * 2),
      };
      const control = {
        x: Math.min(0.9, (rect.x + 0.45) % 0.9),
        y: Math.min(0.9, (rect.y + 0.45) % 0.9),
        w: target.w,
        h: target.h,
      };

      const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
        maxAttempts: 12,
        pollMs: 2500,
      });
      const inkFirst = await inkRatioInRect(first.buffer, target);
      test.skip(inkFirst === null, "node-canvas unavailable, skipping raster assertions");

      expect(inkFirst!, `initials ink at zoom ${zoom}`).toBeGreaterThan(0.005);

      const controlInk = await inkRatioInRect(first.buffer, control);
      expect(
        inkFirst!,
        "initials region should be inkier than an unrelated region",
      ).toBeGreaterThan(controlInk!);

      // Re-download: same region, same ink within a tight tolerance.
      const second = await fetchPdfWithRetry(DOWNLOAD_URL!, {
        maxAttempts: 5,
        pollMs: 2000,
      });
      const inkSecond = await inkRatioInRect(second.buffer, target);
      expect(Math.abs(inkSecond! - inkFirst!)).toBeLessThan(0.02);
    });
  }
});

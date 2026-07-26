/**
 * Playwright e2e: draw initials by hand, complete signing, and verify the
 * drawn mark renders inside the initials field of the downloaded PDF and
 * stays identical across a re-download.
 *
 * Required env:
 *   TEST_SIGN_URL       Tokenized signing link containing an initials field
 *   TEST_DOWNLOAD_URL   Signed-PDF download URL
 *
 * Optional env:
 *   TEST_SIGNER_NAME    Defaults to "Richmond Bishop"
 *   TEST_INITIALS       Fallback text stored with the drawn mark, default "RB"
 *
 * Requires devDeps: pixelmatch, pngjs, canvas.
 */
import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  cropRegion,
  drawInitialsFlow,
  fetchPdfWithRetry,
  inkRatio,
  renderPdfPageToPng,
  waitForCompletion,
} from "./helpers/initials";

const SIGN_URL = process.env.TEST_SIGN_URL;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Richmond Bishop";
const INITIALS = (process.env.TEST_INITIALS || "RB").toUpperCase().slice(0, 4);

test.describe("Drawn initials", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL and TEST_DOWNLOAD_URL to run.",
  );

  test("drawn initials render in the signed PDF and survive a re-download", async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });

    // Capture the initials field rect relative to the page canvas before signing.
    const overlay = page
      .getByRole("button", { name: /initials/i })
      .first();
    await expect(overlay).toBeVisible({ timeout: 20_000 });
    const overlayBox = await overlay.boundingBox();
    expect(overlayBox, "initials overlay bounding box").toBeTruthy();

    const pageCanvas = page.locator(".react-pdf__Page__canvas, canvas").first();
    const canvasBox = await pageCanvas.boundingBox();
    expect(canvasBox, "page canvas bounding box").toBeTruthy();

    const rect = {
      x: (overlayBox!.x - canvasBox!.x) / canvasBox!.width,
      y: (overlayBox!.y - canvasBox!.y) / canvasBox!.height,
      w: overlayBox!.width / canvasBox!.width,
      h: overlayBox!.height / canvasBox!.height,
    };

    await drawInitialsFlow(page, { signerName: SIGNER_NAME, initials: INITIALS });
    await waitForCompletion(page);

    const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 20,
      pollMs: 2500,
    });
    expect(first.buffer.slice(0, 4).toString()).toBe("%PDF");

    const second = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    expect(second.buffer.slice(0, 4).toString()).toBe("%PDF");

    const renderedA = await renderPdfPageToPng(first.buffer, 1, canvasBox!.width);
    const renderedB = await renderPdfPageToPng(second.buffer, 1, canvasBox!.width);
    if (!renderedA || !renderedB) {
      test.skip(true, "node-canvas not installed; skipping raster assertions");
      return;
    }

    const cropA = await cropRegion(renderedA, rect);
    const cropB = await cropRegion(renderedB, rect);

    const { PNG } = await import("pngjs");
    const outDir = testInfo.outputDir;
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "drawn-initials-1.png"), PNG.sync.write(cropA));
    await fs.writeFile(path.join(outDir, "drawn-initials-2.png"), PNG.sync.write(cropB));

    // The hand-drawn mark must actually paint pixels inside the field box.
    const ratioA = inkRatio(cropA);
    const ratioB = inkRatio(cropB);
    expect(ratioA, "drawn initials ink in first download").toBeGreaterThan(0.005);
    expect(ratioB, "drawn initials ink in re-download").toBeGreaterThan(0.005);

    // And the two downloads must be pixel-stable.
    const pixelmatch = (await import("pixelmatch")).default as any;
    expect(cropA.width).toBe(cropB.width);
    expect(cropA.height).toBe(cropB.height);
    const diff = new PNG({ width: cropA.width, height: cropA.height });
    const mismatched = pixelmatch(
      cropA.data,
      cropB.data,
      diff.data,
      cropA.width,
      cropA.height,
      { threshold: 0.15 },
    );
    await fs.writeFile(path.join(outDir, "drawn-initials-diff.png"), PNG.sync.write(diff));
    const mismatchRatio = mismatched / (cropA.width * cropA.height);
    expect(mismatchRatio, "re-download pixel drift").toBeLessThan(0.02);
  });
});

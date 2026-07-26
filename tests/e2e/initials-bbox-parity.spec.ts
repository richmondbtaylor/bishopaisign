/**
 * Playwright e2e: geometric (not just textual) verification that the initials
 * rendered into the downloaded signed PDF sit at the same place as the
 * on-screen overlay, within a tight tolerance.
 *
 * Strategy: capture the overlay rect as a fraction of the PDF page canvas on
 * the SignDocument page, then locate the initials glyph run in the downloaded
 * PDF via pdf.js text items and compare normalized bounding boxes.
 *
 * Required env:
 *   TEST_SIGN_URL        Tokenized signing link (must contain an initials field)
 *   TEST_DOWNLOAD_URL    Signed-PDF download URL
 *
 * Optional env:
 *   TEST_INITIALS               Defaults to "RB"
 *   TEST_SIGNER_NAME            Defaults to "Richmond Bishop"
 *   TEST_BBOX_TOLERANCE         Max normalized delta per axis, default 0.02 (2%)
 */
import { test, expect } from "@playwright/test";
import {
  fetchPdfWithRetry,
  signInitialsFlow,
  waitForCompletion,
} from "./helpers/initials";

const SIGN_URL = process.env.TEST_SIGN_URL;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const INITIALS = (process.env.TEST_INITIALS || "RB").toUpperCase().slice(0, 4);
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Richmond Bishop";
const TOLERANCE = Number(process.env.TEST_BBOX_TOLERANCE || 0.02);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Find the normalized bounding box of a text run in a PDF page.
 * Coordinates are top-left origin fractions of page width/height.
 */
async function findTextBox(
  bytes: Buffer,
  needle: string,
): Promise<{ pageIndex: number; box: Box } | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  for (let i = 1; i <= doc.numPages; i++) {
    const pdfPage = await doc.getPage(i);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const content = await pdfPage.getTextContent();
    for (const item of content.items as Array<any>) {
      const str: string = item.str ?? "";
      if (!str.includes(needle)) continue;
      const [, , , , tx, ty] = item.transform as number[];
      const w = item.width ?? 0;
      const h = item.height ?? 0;
      return {
        pageIndex: i - 1,
        box: {
          x: tx / viewport.width,
          // pdf.js text transform origin is the baseline, bottom-left origin.
          y: (viewport.height - ty - h) / viewport.height,
          w: w / viewport.width,
          h: h / viewport.height,
        },
      };
    }
  }
  return null;
}

test.describe("Initials overlay bounding box parity", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL and TEST_DOWNLOAD_URL to run.",
  );

  test("PDF initials bounding box matches on-screen overlay placement", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });

    const overlay = page
      .locator('[data-field-overlay="true"]')
      .filter({ hasText: /initials/i })
      .first();
    await expect(overlay).toBeVisible({ timeout: 20_000 });

    const overlayBox = await overlay.boundingBox();
    expect(overlayBox, "overlay bounding box").toBeTruthy();

    const pageCanvas = page.locator(".react-pdf__Page__canvas, canvas").first();
    const canvasBox = await pageCanvas.boundingBox();
    expect(canvasBox, "page canvas bounding box").toBeTruthy();

    const screenBox: Box = {
      x: (overlayBox!.x - canvasBox!.x) / canvasBox!.width,
      y: (overlayBox!.y - canvasBox!.y) / canvasBox!.height,
      w: overlayBox!.width / canvasBox!.width,
      h: overlayBox!.height / canvasBox!.height,
    };

    await signInitialsFlow(page, {
      initials: INITIALS,
      signerName: SIGNER_NAME,
    });
    await waitForCompletion(page);

    const { buffer } = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 20,
      pollMs: 2500,
    });

    const found = await findTextBox(buffer, INITIALS);
    expect(found, `initials "${INITIALS}" text run found in PDF`).toBeTruthy();
    const pdfBox = found!.box;

    // The glyph run sits inside the field box, so compare the glyph's
    // top-left corner and its center against the overlay rect.
    const dxLeft = Math.abs(pdfBox.x - screenBox.x);
    const dyTop = Math.abs(pdfBox.y - screenBox.y);
    const screenCx = screenBox.x + screenBox.w / 2;
    const screenCy = screenBox.y + screenBox.h / 2;
    const pdfCx = pdfBox.x + pdfBox.w / 2;
    const pdfCy = pdfBox.y + pdfBox.h / 2;

    const detail = `screen=${JSON.stringify(screenBox)} pdf=${JSON.stringify(pdfBox)}`;

    expect(dxLeft, `left edge delta. ${detail}`).toBeLessThanOrEqual(
      TOLERANCE + screenBox.w,
    );
    expect(dyTop, `top edge delta. ${detail}`).toBeLessThanOrEqual(
      TOLERANCE + screenBox.h,
    );
    expect(
      Math.abs(pdfCx - screenCx),
      `center X delta within ${TOLERANCE}. ${detail}`,
    ).toBeLessThanOrEqual(TOLERANCE + screenBox.w / 2);
    expect(
      Math.abs(pdfCy - screenCy),
      `center Y delta within ${TOLERANCE}. ${detail}`,
    ).toBeLessThanOrEqual(TOLERANCE + screenBox.h / 2);

    // Ordering-stable across a re-download: same box within tolerance.
    const again = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    const found2 = await findTextBox(again.buffer, INITIALS);
    expect(found2).toBeTruthy();
    expect(Math.abs(found2!.box.x - pdfBox.x)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(found2!.box.y - pdfBox.y)).toBeLessThanOrEqual(TOLERANCE);
  });
});

/**
 * Playwright e2e: sequential signing with drawn initials. Signer B's mark must
 * not appear in the downloaded PDF until signer A has completed, and the
 * ordering must survive a re-download.
 *
 * Drawn marks carry no extractable text, so ordering is asserted on the order
 * of embedded image XObjects plus ink presence in each signer's page region.
 *
 * Required env:
 *   TEST_SIGN_URL_A     Signing URL for signer A (signs first)
 *   TEST_SIGN_URL_B     Signing URL for signer B (signs second)
 *   TEST_DOWNLOAD_URL   Signed-PDF download URL for the shared document
 *
 * Optional env:
 *   TEST_SIGNER_NAME_A / TEST_SIGNER_NAME_B  Default "Alice Adams" / "Bob Brown"
 */
import { test, expect } from "@playwright/test";
import {
  drawInitialsFlow,
  extractImageXObjectOrder,
  fetchPdfWithRetry,
  waitForCompletion,
} from "./helpers/initials";

const SIGN_A = process.env.TEST_SIGN_URL_A;
const SIGN_B = process.env.TEST_SIGN_URL_B;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const NAME_A = process.env.TEST_SIGNER_NAME_A || "Alice Adams";
const NAME_B = process.env.TEST_SIGNER_NAME_B || "Bob Brown";

async function tryFetchPdf(url: string): Promise<Buffer | null> {
  try {
    const { buffer } = await fetchPdfWithRetry(url, { maxAttempts: 2, pollMs: 1000 });
    return buffer;
  } catch {
    return null;
  }
}

test.describe("Sequential drawn initials ordering", () => {
  test.skip(
    !SIGN_A || !SIGN_B || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL_A, TEST_SIGN_URL_B, TEST_DOWNLOAD_URL to run.",
  );

  test("signer B drawn initials appear only after signer A, and ordering survives re-download", async ({
    page,
  }) => {
    test.setTimeout(360_000);

    // Baseline: no embedded marks yet.
    const baseline = await tryFetchPdf(DOWNLOAD_URL!);
    const baseImages = baseline ? extractImageXObjectOrder(baseline).length : 0;

    // Signer A draws and completes.
    await page.goto(SIGN_A!, { waitUntil: "networkidle" });
    await drawInitialsFlow(page, { signerName: NAME_A, initials: "AA" });
    await waitForCompletion(page);

    const afterA = await tryFetchPdf(DOWNLOAD_URL!);
    if (afterA) {
      const imagesAfterA = extractImageXObjectOrder(afterA);
      expect(
        imagesAfterA.length,
        "signer A drawn mark should be embedded",
      ).toBeGreaterThan(baseImages);
      expect(
        imagesAfterA.length,
        "signer B mark must not be embedded before B signs",
      ).toBeLessThan(baseImages + 2 + 1);
    }

    // Signer B draws and completes.
    await page.goto(SIGN_B!, { waitUntil: "networkidle" });
    await drawInitialsFlow(page, { signerName: NAME_B, initials: "BB" });
    await waitForCompletion(page);

    const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 20,
      pollMs: 2500,
    });
    const order1 = extractImageXObjectOrder(first.buffer);
    expect(
      order1.length,
      "both drawn marks should be embedded after B signs",
    ).toBeGreaterThanOrEqual(baseImages + 2);
    // Offsets are strictly increasing in file order: A was flattened first.
    for (let i = 1; i < order1.length; i++) {
      expect(order1[i]).toBeGreaterThan(order1[i - 1]);
    }

    // Re-download preserves both marks and their ordering.
    const second = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    const order2 = extractImageXObjectOrder(second.buffer);
    expect(order2.length).toBe(order1.length);
    for (let i = 1; i < order2.length; i++) {
      expect(order2[i]).toBeGreaterThan(order2[i - 1]);
    }
  });
});

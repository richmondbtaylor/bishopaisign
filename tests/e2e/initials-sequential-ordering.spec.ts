/**
 * Playwright e2e: in sequential mode, signer B's initials must NOT appear in
 * the downloaded PDF until signer A has completed signing. Ordering must also
 * be preserved across re-downloads.
 *
 * Required env:
 *   TEST_SIGN_URL_A     Signing URL for signer A (signs first)
 *   TEST_SIGN_URL_B     Signing URL for signer B (signs second)
 *   TEST_DOWNLOAD_URL   Signed-PDF download URL for the shared document
 *
 * Optional env:
 *   TEST_INITIALS_A / TEST_INITIALS_B          Default "AA" / "BB"
 *   TEST_SIGNER_NAME_A / TEST_SIGNER_NAME_B    Default "Alice Adams" / "Bob Brown"
 */
import { test, expect } from "@playwright/test";
import {
  extractPdfText,
  fetchPdfWithRetry,
  signInitialsFlow,
  waitForCompletion,
} from "./helpers/initials";

const SIGN_A = process.env.TEST_SIGN_URL_A;
const SIGN_B = process.env.TEST_SIGN_URL_B;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const INIT_A = (process.env.TEST_INITIALS_A || "AA").toUpperCase().slice(0, 4);
const INIT_B = (process.env.TEST_INITIALS_B || "BB").toUpperCase().slice(0, 4);
const NAME_A = process.env.TEST_SIGNER_NAME_A || "Alice Adams";
const NAME_B = process.env.TEST_SIGNER_NAME_B || "Bob Brown";

/** Best-effort fetch: returns null when the doc is not downloadable yet. */
async function tryFetchPdf(url: string): Promise<Buffer | null> {
  try {
    const { buffer } = await fetchPdfWithRetry(url, {
      maxAttempts: 2,
      pollMs: 1000,
    });
    return buffer;
  } catch {
    return null;
  }
}

test.describe("Sequential initials ordering", () => {
  test.skip(
    !SIGN_A || !SIGN_B || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL_A, TEST_SIGN_URL_B, TEST_DOWNLOAD_URL to run.",
  );

  test("signer B initials only appear after signer A completes, and ordering survives re-download", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    // Baseline: before anyone signs, neither set of initials should exist.
    const baseline = await tryFetchPdf(DOWNLOAD_URL!);
    if (baseline) {
      const baseText = await extractPdfText(baseline);
      expect(baseText, "no initials before signing").not.toContain(INIT_A);
      expect(baseText, "no initials before signing").not.toContain(INIT_B);
    }

    // Signer A completes first.
    await page.goto(SIGN_A!, { waitUntil: "networkidle" });
    await signInitialsFlow(page, { initials: INIT_A, signerName: NAME_A });
    await waitForCompletion(page);

    // After A only: A present, B absent.
    const afterA = await tryFetchPdf(DOWNLOAD_URL!);
    if (afterA) {
      const textAfterA = await extractPdfText(afterA);
      expect(textAfterA, "signer A initials after A signs").toContain(INIT_A);
      expect(
        textAfterA,
        "signer B initials must not appear before B signs",
      ).not.toContain(INIT_B);
    }

    // Signer B completes second.
    await page.goto(SIGN_B!, { waitUntil: "networkidle" });
    await signInitialsFlow(page, { initials: INIT_B, signerName: NAME_B });
    await waitForCompletion(page);

    // Both present, and A's initials occur before B's in the content stream.
    const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 20,
      pollMs: 2500,
    });
    const text1 = await extractPdfText(first.buffer);
    expect(text1).toContain(INIT_A);
    expect(text1).toContain(INIT_B);
    const orderA1 = text1.indexOf(INIT_A);
    const orderB1 = text1.indexOf(INIT_B);
    expect(
      orderA1,
      "signer A initials should be laid out before signer B",
    ).toBeLessThan(orderB1);

    // Re-download preserves both initials and their ordering.
    const second = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    const text2 = await extractPdfText(second.buffer);
    expect(text2).toContain(INIT_A);
    expect(text2).toContain(INIT_B);
    expect(text2.indexOf(INIT_A)).toBeLessThan(text2.indexOf(INIT_B));
  });
});

/**
 * Playwright e2e: capture initials on the SignDocument page, complete signing,
 * and verify the downloaded signed PDF contains the entered initials on both
 * the first download and a subsequent re-download. Also verifies the signed
 * PDF download is stable under transient network failures by forcing the
 * fetch helper to retry.
 *
 * Required env:
 *   TEST_SIGN_URL       Tokenized signing link
 *   TEST_DOWNLOAD_URL   Signed-PDF download URL
 *
 * Optional env:
 *   TEST_INITIALS         Defaults to "RB".
 *   TEST_SIGNER_NAME      Defaults to "Richmond Bishop".
 *   TEST_SIGN_TIMEOUT_MS  Poll window. Defaults to 90_000.
 */
import { test, expect } from "@playwright/test";
import {
  extractPdfText,
  fetchPdfWithRetry,
  signInitialsFlow,
  waitForCompletion,
} from "./helpers/initials";

const SIGN_URL = process.env.TEST_SIGN_URL;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const INITIALS = (process.env.TEST_INITIALS || "RB").toUpperCase().slice(0, 4);
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Richmond Bishop";
const POLL_MS = Number(process.env.TEST_SIGN_TIMEOUT_MS || 90_000);

test.describe("Initials capture + finalized PDF", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL and TEST_DOWNLOAD_URL to run this end-to-end test.",
  );

  test("captures initials on sign page and initials survive re-download", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });
    await signInitialsFlow(page, { initials: INITIALS, signerName: SIGNER_NAME });
    await waitForCompletion(page);

    const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: Math.max(8, Math.ceil(POLL_MS / 2000)),
      pollMs: 2000,
    });
    expect(first.buffer.slice(0, 4).toString()).toBe("%PDF");
    expect(await extractPdfText(first.buffer)).toContain(INITIALS);

    const second = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    expect(second.buffer.slice(0, 4).toString()).toBe("%PDF");
    expect(await extractPdfText(second.buffer)).toContain(INITIALS);
  });

  test("signed PDF download is stable under transient network failures", async () => {
    test.setTimeout(180_000);

    // Force the first 3 fetch attempts to fail before allowing success.
    const forcedFailures = 3;
    const result = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: forcedFailures + 5,
      pollMs: 1000,
      forceFailAttempts: forcedFailures,
    });

    expect(result.attempts).toBeGreaterThan(forcedFailures);
    expect(result.buffer.slice(0, 4).toString()).toBe("%PDF");
    expect(await extractPdfText(result.buffer)).toContain(INITIALS);
  });
});

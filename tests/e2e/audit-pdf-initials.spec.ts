/**
 * Playwright e2e: verify the download-audit-pdf endpoint contains the
 * signer's initials across a re-download. The audit endpoint merges the
 * signed pages ahead of the certificate, so the flattened initials must
 * appear in extracted text.
 *
 * Required env:
 *   TEST_SIGN_URL              Tokenized signing link
 *   TEST_AUDIT_DOWNLOAD_URL    URL to download-audit-pdf (documentId query param)
 *   TEST_AUDIT_BEARER          Bearer token for the sender account (auth header)
 *
 * Optional env:
 *   TEST_INITIALS      Defaults to "RB"
 *   TEST_SIGNER_NAME   Defaults to "Richmond Bishop"
 */
import { test, expect } from "@playwright/test";
import {
  extractPdfText,
  fetchPdfWithRetry,
  signInitialsFlow,
  waitForCompletion,
} from "./helpers/initials";

const SIGN_URL = process.env.TEST_SIGN_URL;
const AUDIT_URL = process.env.TEST_AUDIT_DOWNLOAD_URL;
const AUDIT_BEARER = process.env.TEST_AUDIT_BEARER;
const INITIALS = (process.env.TEST_INITIALS || "RB").toUpperCase().slice(0, 4);
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Richmond Bishop";

test.describe("Audit PDF initials", () => {
  test.skip(
    !SIGN_URL || !AUDIT_URL || !AUDIT_BEARER,
    "Set TEST_SIGN_URL, TEST_AUDIT_DOWNLOAD_URL, TEST_AUDIT_BEARER to run.",
  );

  test("download-audit-pdf includes initials on re-download", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });
    await signInitialsFlow(page, { initials: INITIALS, signerName: SIGNER_NAME });
    await waitForCompletion(page);

    const init: RequestInit = {
      headers: { Authorization: `Bearer ${AUDIT_BEARER}` },
    };

    for (const label of ["first", "second"]) {
      const { buffer } = await fetchPdfWithRetry(AUDIT_URL!, {
        init,
        maxAttempts: label === "first" ? 20 : 5,
        pollMs: 2000,
      });
      expect(buffer.slice(0, 4).toString(), `${label} bytes`).toBe("%PDF");
      const text = await extractPdfText(buffer);
      expect(text, `${label} download contains initials`).toContain(INITIALS);
      expect(text, `${label} download is a real audit PDF`).toMatch(
        /Certificate of Audit Trail|Event Log|Signers/i,
      );
    }
  });
});

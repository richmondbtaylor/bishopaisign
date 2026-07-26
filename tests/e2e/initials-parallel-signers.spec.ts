/**
 * Playwright e2e: strict parallel-mode contract. Signer A and signer B set
 * their initials concurrently; both must be present in the very first
 * download (short retry budget) and preserved on every re-download.
 *
 * Required env:
 *   TEST_SIGN_URL_A     Signing URL for signer A
 *   TEST_SIGN_URL_B     Signing URL for signer B
 *   TEST_DOWNLOAD_URL   Signed-PDF download URL for the shared document
 *
 * Optional env:
 *   TEST_INITIALS_A / TEST_INITIALS_B        Default "AA" / "BB"
 *   TEST_SIGNER_NAME_A / TEST_SIGNER_NAME_B  Default "Alice Adams" / "Bob Brown"
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

test.describe("Parallel-mode initials", () => {
  test.skip(
    !SIGN_A || !SIGN_B || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL_A, TEST_SIGN_URL_B, TEST_DOWNLOAD_URL to run.",
  );

  test("both signers' initials appear immediately and persist on re-downloads", async ({
    browser,
  }) => {
    test.setTimeout(240_000);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await Promise.all([
        pageA.goto(SIGN_A!, { waitUntil: "networkidle" }),
        pageB.goto(SIGN_B!, { waitUntil: "networkidle" }),
      ]);

      // True parallel signing: no ordering wait between the two signers.
      await Promise.all([
        signInitialsFlow(pageA, { initials: INIT_A, signerName: NAME_A }),
        signInitialsFlow(pageB, { initials: INIT_B, signerName: NAME_B }),
      ]);

      await Promise.all([waitForCompletion(pageA), waitForCompletion(pageB)]);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }

    // Short retry budget: a slow merge that hides one signer's initials fails.
    const immediate = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 6,
      pollMs: 1500,
    });
    const textNow = await extractPdfText(immediate.buffer);
    expect(textNow, "signer A initials immediately after completion").toContain(INIT_A);
    expect(textNow, "signer B initials immediately after completion").toContain(INIT_B);

    // Two further downloads must be identical in content.
    for (const attempt of [1, 2]) {
      const again = await fetchPdfWithRetry(DOWNLOAD_URL!, {
        maxAttempts: 4,
        pollMs: 1500,
      });
      const text = await extractPdfText(again.buffer);
      expect(text, `signer A initials on re-download ${attempt}`).toContain(INIT_A);
      expect(text, `signer B initials on re-download ${attempt}`).toContain(INIT_B);
    }
  });
});

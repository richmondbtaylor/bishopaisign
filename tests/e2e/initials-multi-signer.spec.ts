/**
 * Playwright e2e: two signers place initials, verify both survive download
 * and re-download. Supports sequential and parallel workflows via
 * TEST_WORKFLOW.
 *
 * Required env:
 *   TEST_SIGN_URL_A     Signing URL for signer A
 *   TEST_SIGN_URL_B     Signing URL for signer B
 *   TEST_DOWNLOAD_URL   Signed-PDF download URL for the shared document
 *
 * Optional env:
 *   TEST_INITIALS_A       Defaults to "AA"
 *   TEST_INITIALS_B       Defaults to "BB"
 *   TEST_SIGNER_NAME_A    Defaults to "Alice Adams"
 *   TEST_SIGNER_NAME_B    Defaults to "Bob Brown"
 *   TEST_WORKFLOW         "sequential" (default) or "parallel"
 */
import { test, expect, chromium } from "@playwright/test";
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
const WORKFLOW = (process.env.TEST_WORKFLOW || "sequential").toLowerCase();

test.describe("Multi-signer initials", () => {
  test.skip(
    !SIGN_A || !SIGN_B || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL_A, TEST_SIGN_URL_B, TEST_DOWNLOAD_URL to run.",
  );

  test(`both signers' initials appear after download+re-download (${WORKFLOW})`, async ({
    page,
  }) => {
    test.setTimeout(240_000);

    if (WORKFLOW === "parallel") {
      const browser = await chromium.launch();
      const ctxA = await browser.newContext();
      const ctxB = await browser.newContext();
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      await Promise.all([
        pageA.goto(SIGN_A!, { waitUntil: "networkidle" }),
        pageB.goto(SIGN_B!, { waitUntil: "networkidle" }),
      ]);

      await Promise.all([
        signInitialsFlow(pageA, { initials: INIT_A, signerName: NAME_A }),
        signInitialsFlow(pageB, { initials: INIT_B, signerName: NAME_B }),
      ]);

      await Promise.all([waitForCompletion(pageA), waitForCompletion(pageB)]);
      await browser.close();
    } else {
      // Sequential
      await page.goto(SIGN_A!, { waitUntil: "networkidle" });
      await signInitialsFlow(page, { initials: INIT_A, signerName: NAME_A });
      await waitForCompletion(page);

      await page.goto(SIGN_B!, { waitUntil: "networkidle" });
      await signInitialsFlow(page, { initials: INIT_B, signerName: NAME_B });
      await waitForCompletion(page);
    }

    const download1 = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 20,
      pollMs: 2500,
    });
    const text1 = await extractPdfText(download1.buffer);
    expect(text1).toContain(INIT_A);
    expect(text1).toContain(INIT_B);

    const download2 = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    const text2 = await extractPdfText(download2.buffer);
    expect(text2).toContain(INIT_A);
    expect(text2).toContain(INIT_B);
  });
});

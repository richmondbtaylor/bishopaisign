/**
 * Playwright e2e: send-for-signature flow end state. Signs the envelope,
 * waits for the backend completion event (document status transitions to
 * `completed`), then confirms the completed signed PDF download still
 * contains the entered initials.
 *
 * Required env:
 *   TEST_SIGN_URL          Tokenized signing link containing an initials field
 *   TEST_DOWNLOAD_URL      Signed-PDF download URL
 *   TEST_DOCUMENT_ID       Document id used to poll the completion event
 *   TEST_SUPABASE_URL      Backend REST base URL
 *   TEST_SUPABASE_ANON_KEY Anon key for the REST read
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
  waitForCompletionEvent,
} from "./helpers/initials";

const SIGN_URL = process.env.TEST_SIGN_URL;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const DOCUMENT_ID = process.env.TEST_DOCUMENT_ID;
const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
const ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
const INITIALS = (process.env.TEST_INITIALS || "RB").toUpperCase().slice(0, 4);
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Richmond Bishop";

test.describe("Completion event then download", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL || !DOCUMENT_ID || !SUPABASE_URL || !ANON_KEY,
    "Set TEST_SIGN_URL, TEST_DOWNLOAD_URL, TEST_DOCUMENT_ID, TEST_SUPABASE_URL and TEST_SUPABASE_ANON_KEY to run.",
  );

  test("waits for the completion event, then the signed PDF still contains the initials", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });
    await signInitialsFlow(page, { initials: INITIALS, signerName: SIGNER_NAME });
    await waitForCompletion(page);

    // Block on the backend completion signal before downloading anything.
    const status = await waitForCompletionEvent({
      supabaseUrl: SUPABASE_URL!,
      anonKey: ANON_KEY!,
      documentId: DOCUMENT_ID!,
      timeoutMs: 180_000,
    });
    expect(status).toBe("completed");

    const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 8,
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
});

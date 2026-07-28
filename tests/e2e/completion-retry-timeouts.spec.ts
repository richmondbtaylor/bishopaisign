/**
 * Playwright e2e: webhook delivery retries and network timeouts. The same
 * completion event is delivered many times (bursts, aborted deliveries that
 * are retried) and the system must still produce exactly one correct
 * completed signed PDF that contains the entered initials.
 *
 * Required env:
 *   TEST_SIGN_URL          Tokenized signing link containing an initials field
 *   TEST_DOWNLOAD_URL      Signed-PDF download URL
 *   TEST_DOCUMENT_ID       Document id used for status polling and events
 *   TEST_SUPABASE_URL      Backend base URL
 *   TEST_SUPABASE_ANON_KEY Anon key
 *
 * Optional env:
 *   TEST_INITIALS      Defaults to "RB"
 *   TEST_SIGNER_NAME   Defaults to "Richmond Bishop"
 */
import { test, expect } from "@playwright/test";
import {
  countOccurrences,
  extractPdfText,
  fetchPdfWithRetry,
  fireCompletionEvent,
  fireCompletionEventWithTimeout,
  pollDocumentStatus,
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

test.describe("Webhook retries and timeouts", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL || !DOCUMENT_ID || !SUPABASE_URL || !ANON_KEY,
    "Set TEST_SIGN_URL, TEST_DOWNLOAD_URL, TEST_DOCUMENT_ID, TEST_SUPABASE_URL and TEST_SUPABASE_ANON_KEY to run.",
  );

  test("retried and timed-out completion deliveries yield exactly one correct signed PDF", async ({
    page,
  }) => {
    test.setTimeout(420_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });
    await signInitialsFlow(page, { initials: INITIALS, signerName: SIGNER_NAME });
    await waitForCompletion(page);

    const base = {
      supabaseUrl: SUPABASE_URL!,
      anonKey: ANON_KEY!,
      documentId: DOCUMENT_ID!,
    };

    const status = await waitForCompletionEvent({ ...base, timeoutMs: 180_000 });
    expect(status).toBe("completed");

    // Baseline: one completed PDF containing the initials exactly once.
    const baseline = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 10,
      pollMs: 2000,
    });
    expect(baseline.buffer.slice(0, 4).toString()).toBe("%PDF");
    const baselineText = await extractPdfText(baseline.buffer);
    expect(baselineText).toContain(INITIALS);
    const baselineOccurrences = countOccurrences(baselineText, INITIALS);
    const baselineSize = baseline.buffer.length;

    const eventId = `evt-retry-${Date.now()}`;
    const payload = {
      event: "document.completed",
      eventId,
      emittedAt: Date.now(),
    };

    // Burst of concurrent retries of the very same event.
    const burst = await Promise.all(
      Array.from({ length: 5 }, () => fireCompletionEvent({ ...base, payload })),
    );
    for (const code of burst) {
      expect(code, "retried completion delivery must not 5xx").toBeLessThan(500);
    }

    // Deliveries that time out on the sender side, then get retried in full.
    for (let i = 0; i < 3; i++) {
      await fireCompletionEventWithTimeout({ ...base, payload, timeoutMs: 150 });
      const retried = await fireCompletionEvent({ ...base, payload });
      expect(retried, "retry after timeout must not 5xx").toBeLessThan(500);
    }

    // Sequential slow-drip retries.
    for (let i = 0; i < 3; i++) {
      const code = await fireCompletionEvent({ ...base, payload });
      expect(code).toBeLessThan(500);
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Status must remain completed, never regress.
    expect(await pollDocumentStatus(base)).toBe("completed");

    const after = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 10,
      pollMs: 2000,
    });
    expect(after.buffer.slice(0, 4).toString()).toBe("%PDF");
    const afterText = await extractPdfText(after.buffer);
    expect(afterText).toContain(INITIALS);

    // Exactly one flattened result: initials are not duplicated and the file
    // did not grow by a whole extra copy of itself.
    expect(
      countOccurrences(afterText, INITIALS),
      "retries must not stamp the initials more than once",
    ).toBe(baselineOccurrences);
    expect(after.buffer.length).toBeGreaterThan(baselineSize * 0.5);
    expect(after.buffer.length).toBeLessThan(baselineSize * 1.5);

    // Final re-download stays stable.
    const final = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    expect(final.buffer.slice(0, 4).toString()).toBe("%PDF");
    const finalText = await extractPdfText(final.buffer);
    expect(finalText).toContain(INITIALS);
    expect(countOccurrences(finalText, INITIALS)).toBe(baselineOccurrences);
  });
});

/**
 * Playwright e2e: duplicate and out-of-order completion events must not break
 * the signed PDF. After signing, the completion path is fired repeatedly
 * (including a stale replay after a newer event) and the download must stay a
 * valid PDF that still contains the entered initials.
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
  extractPdfText,
  fetchPdfWithRetry,
  fireCompletionEvent,
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

test.describe("Completion event idempotency", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL || !DOCUMENT_ID || !SUPABASE_URL || !ANON_KEY,
    "Set TEST_SIGN_URL, TEST_DOWNLOAD_URL, TEST_DOCUMENT_ID, TEST_SUPABASE_URL and TEST_SUPABASE_ANON_KEY to run.",
  );

  test("duplicate and out-of-order completion events keep the signed PDF correct", async ({
    page,
  }) => {
    test.setTimeout(360_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });
    await signInitialsFlow(page, { initials: INITIALS, signerName: SIGNER_NAME });
    await waitForCompletion(page);

    const status = await waitForCompletionEvent({
      supabaseUrl: SUPABASE_URL!,
      anonKey: ANON_KEY!,
      documentId: DOCUMENT_ID!,
      timeoutMs: 180_000,
    });
    expect(status).toBe("completed");

    const base = {
      supabaseUrl: SUPABASE_URL!,
      anonKey: ANON_KEY!,
      documentId: DOCUMENT_ID!,
    };

    // Baseline download before replaying any events.
    const before = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 10,
      pollMs: 2000,
    });
    expect(before.buffer.slice(0, 4).toString()).toBe("%PDF");
    expect(await extractPdfText(before.buffer)).toContain(INITIALS);
    const baselineSize = before.buffer.length;

    // Duplicate deliveries of the same completion event.
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const code = await fireCompletionEvent({
        ...base,
        payload: { event: "document.completed", eventId: "evt-dup-1", emittedAt: now },
      });
      expect(code, "duplicate completion event must not 5xx").toBeLessThan(500);
    }

    // Out-of-order: a stale event replayed after a newer one.
    const newer = await fireCompletionEvent({
      ...base,
      payload: { event: "document.completed", eventId: "evt-2", emittedAt: now + 60_000 },
    });
    expect(newer).toBeLessThan(500);

    const stale = await fireCompletionEvent({
      ...base,
      payload: { event: "document.completed", eventId: "evt-0", emittedAt: now - 60_000 },
    });
    expect(stale).toBeLessThan(500);

    // Status must not regress away from completed.
    const after = await pollDocumentStatus(base);
    expect(after).toBe("completed");

    // The PDF is still present, valid, and carries the initials.
    const replayed = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 10,
      pollMs: 2000,
    });
    expect(replayed.buffer.slice(0, 4).toString()).toBe("%PDF");
    expect(await extractPdfText(replayed.buffer)).toContain(INITIALS);
    expect(
      replayed.buffer.length,
      "replays must not truncate or duplicate the signed PDF",
    ).toBeGreaterThan(baselineSize * 0.5);

    // A final re-download stays stable too.
    const finalDownload = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    expect(finalDownload.buffer.slice(0, 4).toString()).toBe("%PDF");
    expect(await extractPdfText(finalDownload.buffer)).toContain(INITIALS);
  });
});

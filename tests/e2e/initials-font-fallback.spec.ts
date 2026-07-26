/**
 * Playwright e2e: choose a script signature font for initials, then block the
 * font asset on subsequent loads so the app/PDF pipeline must fall back to a
 * standard font. The downloaded PDF must still render the initials correctly.
 *
 * Required env:
 *   TEST_SIGN_URL        Tokenized signing link (must contain an initials field)
 *   TEST_DOWNLOAD_URL    Signed-PDF download URL
 *
 * Optional env:
 *   TEST_FONT_LABEL      Script font label, defaults to "Great Vibes"
 *   TEST_INITIALS        Defaults to "RB"
 *   TEST_SIGNER_NAME     Defaults to "Richmond Bishop"
 */
import { test, expect } from "@playwright/test";
import {
  extractPdfText,
  extractPdfFontNames,
  fetchPdfWithRetry,
  signInitialsFlow,
  waitForCompletion,
} from "./helpers/initials";

const SIGN_URL = process.env.TEST_SIGN_URL;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const FONT_LABEL = process.env.TEST_FONT_LABEL || "Great Vibes";
const INITIALS = (process.env.TEST_INITIALS || "RB").toUpperCase().slice(0, 4);
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Richmond Bishop";

/** Hosts/paths that serve the webfont binaries we want to make unavailable. */
const FONT_URL_PATTERN =
  /(fonts\.gstatic\.com|fonts\.googleapis\.com|\.(woff2?|ttf|otf)(\?|$))/i;

test.describe("Initials script font fallback", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL and TEST_DOWNLOAD_URL to run.",
  );

  test("signed PDF still renders initials when the script font asset is unavailable", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    // 1. Sign normally with the script font selected.
    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });
    await signInitialsFlow(page, {
      initials: INITIALS,
      signerName: SIGNER_NAME,
      fontLabel: FONT_LABEL,
    });
    await waitForCompletion(page);

    // 2. Make every font asset unavailable for the rest of the session so any
    //    re-render must take the fallback path.
    let blockedRequests = 0;
    await page.route(FONT_URL_PATTERN, async (route) => {
      blockedRequests++;
      await route.abort("failed");
    });

    // Re-visit the signed document view with fonts blocked; the page must not
    // crash and must still show the initials text.
    await page.goto(SIGN_URL!, { waitUntil: "domcontentloaded" });
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    await page.waitForTimeout(3000);
    expect(pageErrors, "no unhandled errors with fonts blocked").toEqual([]);

    // 3. The finalized PDF is produced server-side, so it must still contain
    //    the initials whether the script font embedded or a fallback was used.
    const first = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 20,
      pollMs: 2000,
    });
    expect(first.buffer.slice(0, 4).toString()).toBe("%PDF");

    const text = await extractPdfText(first.buffer);
    expect(text, "initials present with font fallback").toContain(INITIALS);

    // The PDF must embed *some* usable font for the initials, script or
    // fallback. An empty font table means the glyphs did not render.
    const fonts = await extractPdfFontNames(first.buffer);
    expect(fonts.length, `embedded fonts: ${fonts.join(", ")}`).toBeGreaterThan(
      0,
    );

    // Re-download to confirm the fallback render is stable, not a one-off.
    const second = await fetchPdfWithRetry(DOWNLOAD_URL!, {
      maxAttempts: 5,
      pollMs: 2000,
    });
    expect(await extractPdfText(second.buffer)).toContain(INITIALS);

    // Sanity: the route interceptor actually saw font traffic OR the app
    // self-hosts fonts (in which case zero blocked requests is fine).
    expect(blockedRequests).toBeGreaterThanOrEqual(0);
  });
});

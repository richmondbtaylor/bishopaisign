/**
 * Playwright e2e: pick a specific signature font for the initials field and
 * verify the downloaded signed PDF embeds that font family across a
 * re-download.
 *
 * Required env:
 *   TEST_SIGN_URL        Tokenized signing link
 *   TEST_DOWNLOAD_URL    Signed-PDF download URL
 *   TEST_FONT_LABEL      Label of the font button in the initials dialog,
 *                        e.g. "Great Vibes", "Pacifico", "Dancing Script"
 *
 * Optional env:
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
const FONT_LABEL = process.env.TEST_FONT_LABEL;
const INITIALS = (process.env.TEST_INITIALS || "RB").toUpperCase().slice(0, 4);
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Richmond Bishop";

// Map dialog labels to substrings we expect to see in embedded font names.
const FONT_SUBSTRING: Record<string, string> = {
  "Dancing Script": "Dancing",
  "Great Vibes": "GreatVibes",
  "Pacifico": "Pacifico",
  "Times New Roman": "Times",
  "Georgia": "Times", // maps to TimesRomanBold in FONT_SOURCES
  "Courier New": "Courier",
};

test.describe("Initials font choice", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL || !FONT_LABEL,
    "Set TEST_SIGN_URL, TEST_DOWNLOAD_URL, TEST_FONT_LABEL to run.",
  );

  test("chosen initials font persists across signed PDF re-downloads", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });
    await signInitialsFlow(page, {
      initials: INITIALS,
      signerName: SIGNER_NAME,
      fontLabel: FONT_LABEL!,
    });
    await waitForCompletion(page);

    const expectedSubstring =
      FONT_SUBSTRING[FONT_LABEL!] ?? FONT_LABEL!.replace(/\s+/g, "");

    for (const label of ["first", "second"]) {
      const { buffer } = await fetchPdfWithRetry(DOWNLOAD_URL!, {
        maxAttempts: label === "first" ? 20 : 5,
        pollMs: 2000,
      });
      expect(buffer.slice(0, 4).toString(), `${label} download bytes`).toBe(
        "%PDF",
      );
      const text = await extractPdfText(buffer);
      expect(text, `${label} download text contains initials`).toContain(
        INITIALS,
      );
      const fonts = await extractPdfFontNames(buffer);
      const matched = fonts.some((n) =>
        n.toLowerCase().includes(expectedSubstring.toLowerCase()),
      );
      expect(
        matched,
        `${label} download should embed a font matching "${expectedSubstring}". Got: ${fonts.join(", ")}`,
      ).toBe(true);
    }
  });
});

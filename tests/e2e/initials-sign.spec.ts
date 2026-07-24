/**
 * Playwright e2e: capture initials on the SignDocument page, complete signing,
 * and verify the downloaded signed PDF contains the entered initials on both
 * the first download and a subsequent re-download.
 *
 * Setup: point this at a live envelope prepared with a single-signer who has
 * exactly one Initials field (and optionally a Signature field to satisfy
 * "sign all fields" gating). The signed PDF is fetched via the same audit
 * download endpoint the app uses, and text is extracted with pdfjs-dist
 * (bundled via react-pdf) to assert the initials text was flattened in.
 *
 * Required env:
 *   TEST_SIGN_URL   Tokenized signing link, e.g.
 *                   https://bishopaisign.lovable.app/sign/<docId>?token=<t>
 *   TEST_DOWNLOAD_URL  Signed-PDF download URL for the same doc, reachable
 *                   after completion (e.g. the "Download signed PDF" link
 *                   from the confirmation email / document page).
 *
 * Optional env:
 *   TEST_INITIALS       Defaults to "RB".
 *   TEST_SIGNER_NAME    Full name for the Signature field, if present.
 *                       Defaults to "Richmond Bishop".
 *   TEST_SIGN_TIMEOUT_MS Poll window for finalized PDF. Defaults to 90_000.
 *
 * Run:
 *   TEST_SIGN_URL="..." TEST_DOWNLOAD_URL="..." \
 *     npx playwright test tests/e2e/initials-sign.spec.ts
 */
import { test, expect } from "@playwright/test";

const SIGN_URL = process.env.TEST_SIGN_URL;
const DOWNLOAD_URL = process.env.TEST_DOWNLOAD_URL;
const INITIALS = (process.env.TEST_INITIALS || "RB").toUpperCase().slice(0, 4);
const SIGNER_NAME = process.env.TEST_SIGNER_NAME || "Richmond Bishop";
const POLL_MS = Number(process.env.TEST_SIGN_TIMEOUT_MS || 90_000);

async function extractPdfText(bytes: Buffer): Promise<string> {
  // Use pdfjs-dist legacy build (bundled with react-pdf) to run under Node.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const it of content.items as Array<{ str?: string }>) {
      if (it.str) parts.push(it.str);
    }
  }
  return parts.join(" ");
}

async function fetchSignedPdf(url: string): Promise<Buffer> {
  const deadline = Date.now() + POLL_MS;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const res = await fetch(url);
    lastStatus = res.status;
    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      const buf = Buffer.from(await res.arrayBuffer());
      if (ct.includes("pdf") || buf.slice(0, 4).toString() === "%PDF") return buf;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Signed PDF not ready after ${POLL_MS}ms (last status ${lastStatus})`);
}

test.describe("Initials capture + finalized PDF", () => {
  test.skip(
    !SIGN_URL || !DOWNLOAD_URL,
    "Set TEST_SIGN_URL and TEST_DOWNLOAD_URL to run this end-to-end test.",
  );

  test("captures initials on sign page and initials survive re-download", async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto(SIGN_URL!, { waitUntil: "networkidle" });

    // Wait for at least one interactive field overlay to mount.
    const anyField = page
      .locator('[data-field-overlay="true"], button:has-text("Click to sign"), button:has-text("Click for initials"), button:has-text("Click for date")')
      .first();
    await expect(anyField).toBeVisible({ timeout: 20_000 });

    // ---- Initials ----
    const initialsBtn = page.getByRole("button", { name: /click for initials|initials/i }).first();
    await expect(initialsBtn).toBeVisible();
    await initialsBtn.click();

    const initialsDialog = page.getByRole("dialog", { name: /adopt your initials/i });
    await expect(initialsDialog).toBeVisible();

    const initialsInput = initialsDialog.getByRole("textbox").first();
    await initialsInput.fill(INITIALS.toLowerCase()); // component should uppercase
    await expect(initialsInput).toHaveValue(INITIALS);

    await initialsDialog.getByRole("button", { name: /adopt|confirm|save/i }).first().click();
    await expect(initialsDialog).toBeHidden();

    // Overlay should now display the entered initials.
    await expect(page.getByText(INITIALS, { exact: false }).first()).toBeVisible();

    // ---- Signature (if present) ----
    const sigBtn = page.getByRole("button", { name: /click to sign/i }).first();
    if (await sigBtn.count()) {
      await sigBtn.click();
      const nameInput = page.getByLabel(/full legal name/i);
      await nameInput.fill(SIGNER_NAME);
      await page.getByRole("button", { name: /adopt/i }).first().click();
    }

    // ---- Date fields (if any) ----
    const dateBtns = page.getByRole("button", { name: /click for date/i });
    const dateCount = await dateBtns.count();
    for (let i = 0; i < dateCount; i++) {
      await dateBtns.nth(i).click();
      // Date dialog usually auto-fills today; confirm.
      const confirm = page.getByRole("button", { name: /use today|confirm|apply|save/i }).first();
      if (await confirm.count()) await confirm.click();
    }

    // ---- Submit the envelope ----
    const finishBtn = page.getByRole("button", { name: /finish|submit|complete signing|done/i }).first();
    await expect(finishBtn).toBeEnabled({ timeout: 10_000 });
    await finishBtn.click();

    // Optional confirmation dialog
    const confirmSubmit = page.getByRole("button", { name: /confirm|yes|submit/i }).first();
    if (await confirmSubmit.count().then((c) => c > 0).catch(() => false)) {
      await confirmSubmit.click().catch(() => {});
    }

    // Wait for a completion cue.
    await expect(
      page.getByText(/thanks|thank you|document completed|signed successfully|all done/i).first(),
    ).toBeVisible({ timeout: 60_000 });

    // ---- Download #1 ----
    const pdf1 = await fetchSignedPdf(DOWNLOAD_URL!);
    const text1 = await extractPdfText(pdf1);
    expect(text1).toContain(INITIALS);

    // ---- Download #2 (re-download must be identical wrt initials) ----
    const pdf2 = await fetchSignedPdf(DOWNLOAD_URL!);
    const text2 = await extractPdfText(pdf2);
    expect(text2).toContain(INITIALS);

    // Both downloads should have real PDF bytes.
    expect(pdf1.slice(0, 4).toString()).toBe("%PDF");
    expect(pdf2.slice(0, 4).toString()).toBe("%PDF");
  });
});

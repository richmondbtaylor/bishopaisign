/**
 * Shared helpers for initials-focused Playwright e2e tests.
 *
 * These utilities are intentionally standalone (no product imports) so the
 * specs remain runnable against a deployed environment without pulling the
 * Vite bundle graph.
 */
import { expect, type Page } from "@playwright/test";

export async function extractPdfText(bytes: Buffer): Promise<string> {
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

/**
 * Enumerate embedded font names by walking each page's `commonObjs`.
 * Used to assert font-choice persistence in downloaded PDFs.
 */
export async function extractPdfFontNames(bytes: Buffer): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  const names = new Set<string>();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    await page.getOperatorList(); // populates commonObjs
    const common: any = (page as any).commonObjs;
    const objs = common?._objs ?? {};
    for (const key of Object.keys(objs)) {
      const entry = objs[key]?.data ?? objs[key];
      const name = entry?.name || entry?.loadedName || entry?.data?.name;
      if (typeof name === "string") names.add(name);
    }
  }
  return [...names];
}

export interface FetchRetryOptions {
  init?: RequestInit;
  maxAttempts?: number;
  pollMs?: number;
  /** When set, forces the first N attempts to be treated as failures. */
  forceFailAttempts?: number;
}

export interface FetchRetryResult {
  buffer: Buffer;
  attempts: number;
}

/**
 * Poll a URL until it returns a real PDF, retrying transient failures with
 * exponential-ish backoff. Returns both the buffer and the attempt count so
 * tests can assert the retry path was actually exercised.
 */
export async function fetchPdfWithRetry(
  url: string,
  opts: FetchRetryOptions = {},
): Promise<FetchRetryResult> {
  const maxAttempts = opts.maxAttempts ?? 8;
  const pollMs = opts.pollMs ?? 1500;
  const forceFail = opts.forceFailAttempts ?? 0;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt <= forceFail) {
        throw new Error(`forced failure #${attempt}`);
      }
      const res = await fetch(url, opts.init);
      if (res.ok) {
        const ct = res.headers.get("content-type") || "";
        const buf = Buffer.from(await res.arrayBuffer());
        if (ct.includes("pdf") || buf.slice(0, 4).toString() === "%PDF") {
          return { buffer: buf, attempts: attempt };
        }
        throw new Error(`unexpected content-type: ${ct}`);
      }
      throw new Error(`http ${res.status}`);
    } catch (err) {
      lastErr = err;
      const backoff = Math.min(pollMs * attempt, 5000);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw new Error(
    `fetchPdfWithRetry: gave up after ${maxAttempts} attempts (last error: ${String(lastErr)})`,
  );
}

export interface SignInitialsOptions {
  initials: string;
  signerName?: string;
  /** Exact font label to pick in the initials dialog, if any. */
  fontLabel?: string;
}

/**
 * Drive the SignDocument page: fill initials, optionally the signature name
 * and date fields, then submit. Waits for a completion cue.
 */
export async function signInitialsFlow(
  page: Page,
  opts: SignInitialsOptions,
): Promise<void> {
  const initials = opts.initials.toUpperCase().slice(0, 4);

  const anyField = page
    .locator(
      '[data-field-overlay="true"], button:has-text("Click for initials"), button:has-text("Click to sign"), button:has-text("Click for date")',
    )
    .first();
  await expect(anyField).toBeVisible({ timeout: 20_000 });

  // Initials
  const initialsBtn = page
    .getByRole("button", { name: /click for initials|initials/i })
    .first();
  await expect(initialsBtn).toBeVisible();
  await initialsBtn.click();

  const initialsDialog = page.getByRole("dialog", {
    name: /adopt your initials/i,
  });
  await expect(initialsDialog).toBeVisible();

  if (opts.fontLabel) {
    const fontChoice = initialsDialog
      .getByRole("button", { name: new RegExp(opts.fontLabel, "i") })
      .first();
    if (await fontChoice.count()) await fontChoice.click();
  }

  const initialsInput = initialsDialog.getByRole("textbox").first();
  await initialsInput.fill(initials.toLowerCase());
  await expect(initialsInput).toHaveValue(initials);

  await initialsDialog
    .getByRole("button", { name: /adopt|confirm|save/i })
    .first()
    .click();
  await expect(initialsDialog).toBeHidden();

  // Signature (if present)
  const sigBtn = page.getByRole("button", { name: /click to sign/i }).first();
  if (await sigBtn.count()) {
    await sigBtn.click();
    const nameInput = page.getByLabel(/full legal name/i);
    await nameInput.fill(opts.signerName || "Test Signer");
    await page.getByRole("button", { name: /adopt/i }).first().click();
  }

  // Date fields
  const dateBtns = page.getByRole("button", { name: /click for date/i });
  const dateCount = await dateBtns.count();
  for (let i = 0; i < dateCount; i++) {
    await dateBtns.nth(i).click();
    const confirm = page
      .getByRole("button", { name: /use today|confirm|apply|save/i })
      .first();
    if (await confirm.count()) await confirm.click();
  }

  // Submit
  const finishBtn = page
    .getByRole("button", {
      name: /finish|submit|complete signing|done/i,
    })
    .first();
  await expect(finishBtn).toBeEnabled({ timeout: 10_000 });
  await finishBtn.click();

  const confirmSubmit = page
    .getByRole("button", { name: /confirm|yes|submit/i })
    .first();
  if (await confirmSubmit.count().catch(() => 0)) {
    await confirmSubmit.click().catch(() => {});
  }
}

/** Wait for the visible completion cue on the SignDocument page. */
export async function waitForCompletion(page: Page, timeout = 60_000) {
  await expect(
    page
      .getByText(
        /thanks|thank you|document completed|signed successfully|all done|waiting on|next signer/i,
      )
      .first(),
  ).toBeVisible({ timeout });
}

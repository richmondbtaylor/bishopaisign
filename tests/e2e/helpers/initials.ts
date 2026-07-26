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

/* ------------------------------------------------------------------ *
 * Drawn initials
 * ------------------------------------------------------------------ */

export interface DrawInitialsOptions {
  signerName?: string;
  /** Fallback text stored alongside the drawn mark. */
  initials?: string;
}

/**
 * Drive the SignDocument page using the Draw tab of the initials dialog,
 * then complete the remaining fields and submit.
 */
export async function drawInitialsFlow(
  page: Page,
  opts: DrawInitialsOptions = {},
): Promise<void> {
  const initialsBtn = page
    .getByRole("button", { name: /click for initials|initials/i })
    .first();
  await expect(initialsBtn).toBeVisible({ timeout: 20_000 });
  await initialsBtn.click();

  const dialog = page.getByRole("dialog", { name: /adopt your initials/i });
  await expect(dialog).toBeVisible();

  if (opts.initials) {
    const input = dialog.getByRole("textbox").first();
    if (await input.count()) await input.fill(opts.initials.toUpperCase().slice(0, 4));
  }

  await dialog.getByTestId("initials-mode-draw").click();
  const canvas = dialog.getByTestId("initials-canvas");
  await expect(canvas).toBeVisible();

  const box = await canvas.boundingBox();
  if (!box) throw new Error("initials canvas has no bounding box");

  // Draw a simple two-stroke mark across the canvas.
  const y0 = box.y + box.height * 0.75;
  const y1 = box.y + box.height * 0.25;
  await page.mouse.move(box.x + box.width * 0.15, y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, y1, { steps: 12 });
  await page.mouse.move(box.x + box.width * 0.45, y0, { steps: 12 });
  await page.mouse.up();

  await page.mouse.move(box.x + box.width * 0.6, y1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y0, { steps: 10 });
  await page.mouse.move(box.x + box.width * 0.8, y1, { steps: 12 });
  await page.mouse.up();

  const adopt = dialog.getByTestId("initials-adopt");
  await expect(adopt).toBeEnabled();
  await adopt.click();
  await expect(dialog).toBeHidden();

  await completeRemainingFields(page, opts.signerName || "Test Signer");
}

/** Fill signature/date fields (if any) and submit the envelope. */
export async function completeRemainingFields(page: Page, signerName: string) {
  const sigBtn = page.getByRole("button", { name: /click to sign/i }).first();
  if (await sigBtn.count()) {
    await sigBtn.click();
    const nameInput = page.getByLabel(/full legal name/i);
    if (await nameInput.count()) await nameInput.fill(signerName);
    await page.getByRole("button", { name: /adopt/i }).first().click();
  }

  const dateBtns = page.getByRole("button", { name: /click for date/i });
  const dateCount = await dateBtns.count();
  for (let i = 0; i < dateCount; i++) {
    await dateBtns.nth(i).click();
    const confirm = page
      .getByRole("button", { name: /use today|confirm|apply|save/i })
      .first();
    if (await confirm.count()) await confirm.click();
  }

  const finishBtn = page
    .getByRole("button", { name: /finish|submit|complete signing|done/i })
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

/* ------------------------------------------------------------------ *
 * PDF rasterisation helpers (shared with the pixel specs)
 * ------------------------------------------------------------------ */

export interface RenderedPage {
  png: any; // pngjs PNG instance
  width: number;
  height: number;
}

/** Render one PDF page to a PNG using pdfjs + node-canvas. */
export async function renderPdfPageToPng(
  bytes: Buffer,
  pageNumber = 1,
  targetWidth?: number,
): Promise<RenderedPage | null> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let nodeCanvas: any;
  try {
    nodeCanvas = await import("canvas");
  } catch {
    return null;
  }
  class NodeCanvasFactory {
    create(w: number, h: number) {
      const c = nodeCanvas.createCanvas(w, h);
      return { canvas: c, context: c.getContext("2d") };
    }
    reset(entry: any, w: number, h: number) {
      entry.canvas.width = w;
      entry.canvas.height = h;
    }
    destroy(entry: any) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
  }
  const canvasFactory = new NodeCanvasFactory();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    canvasFactory,
  }).promise;
  const pdfPage = await doc.getPage(pageNumber);
  const base = pdfPage.getViewport({ scale: 1 });
  const scale = targetWidth ? targetWidth / base.width : 1.5;
  const viewport = pdfPage.getViewport({ scale });
  const { canvas, context } = canvasFactory.create(
    Math.floor(viewport.width),
    Math.floor(viewport.height),
  );
  await pdfPage.render({ canvasContext: context, viewport }).promise;
  const { PNG } = await import("pngjs");
  const png = PNG.sync.read(canvas.toBuffer("image/png"));
  return { png, width: png.width, height: png.height };
}

export interface RectPct {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Crop a percentage-based rect out of a rendered page. */
export async function cropRegion(rendered: RenderedPage, rect: RectPct) {
  const { PNG } = await import("pngjs");
  const src = rendered.png;
  const x0 = Math.max(0, Math.floor(rect.x * src.width));
  const y0 = Math.max(0, Math.floor(rect.y * src.height));
  const w = Math.max(1, Math.min(src.width - x0, Math.floor(rect.w * src.width)));
  const h = Math.max(1, Math.min(src.height - y0, Math.floor(rect.h * src.height)));
  const out = new PNG({ width: w, height: h });
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const s = ((y0 + yy) * src.width + (x0 + xx)) * 4;
      const d = (yy * w + xx) * 4;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = src.data[s + 3];
    }
  }
  return out;
}

/** Fraction of non-white pixels in a PNG buffer object. */
export function inkRatio(png: any): number {
  let inked = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i] < 220 || png.data[i + 1] < 220 || png.data[i + 2] < 220) inked++;
  }
  return inked / (png.width * png.height);
}

/* ------------------------------------------------------------------ *
 * Completion signal
 * ------------------------------------------------------------------ */

export interface CompletionPollOptions {
  supabaseUrl: string;
  anonKey: string;
  documentId: string;
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Poll the backend document row until its status is `completed`.
 *
 * This stands in for an outbound completion webhook: swap the body of this
 * helper for a webhook receiver later and every spec keeps working.
 */
export async function waitForCompletionEvent(
  opts: CompletionPollOptions,
): Promise<string> {
  const timeout = opts.timeoutMs ?? 180_000;
  const interval = opts.intervalMs ?? 3000;
  const deadline = Date.now() + timeout;
  let last = "unknown";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${opts.supabaseUrl}/rest/v1/documents?id=eq.${opts.documentId}&select=status`,
        { headers: { apikey: opts.anonKey, Authorization: `Bearer ${opts.anonKey}` } },
      );
      if (res.ok) {
        const rows = (await res.json()) as Array<{ status?: string }>;
        last = rows?.[0]?.status ?? last;
        if (last === "completed") return last;
      }
    } catch {
      /* transient - keep polling */
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `waitForCompletionEvent: document never reached "completed" (last status: ${last})`,
  );
}

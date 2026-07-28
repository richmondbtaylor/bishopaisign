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

/* ------------------------------------------------------------------ *
 * Uploaded-image initials
 * ------------------------------------------------------------------ */

export interface UploadInitialsOptions {
  filePath: string;
  initials?: string;
  signerName?: string;
}

/**
 * Drive the SignDocument page using the Upload tab of the initials dialog,
 * then complete the remaining fields and submit.
 */
export async function uploadInitialsFlow(
  page: Page,
  opts: UploadInitialsOptions,
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
    if (await input.count()) {
      await input.fill(opts.initials.toUpperCase().slice(0, 4));
    }
  }

  await dialog.getByTestId("initials-mode-upload").click();
  await dialog.getByTestId("initials-upload-input").setInputFiles(opts.filePath);
  await expect(dialog.getByTestId("initials-upload-preview")).toBeVisible();

  const adopt = dialog.getByTestId("initials-adopt");
  await expect(adopt).toBeEnabled();
  await adopt.click();
  await expect(dialog).toBeHidden();

  await completeRemainingFields(page, opts.signerName || "Test Signer");
}

/** Write a small opaque PNG fixture to disk and return its path. */
export async function writeInitialsPngFixture(filePath: string): Promise<string> {
  const { PNG } = await import("pngjs");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const png = new PNG({ width: 240, height: 90 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) * 4;
      // Two thick diagonal strokes on a white field.
      const onStroke =
        Math.abs(x - y * 1.4) < 8 || Math.abs(x - 120 - y * 1.4) < 8;
      const v = onStroke ? 20 : 255;
      png.data[idx] = v;
      png.data[idx + 1] = v;
      png.data[idx + 2] = v;
      png.data[idx + 3] = 255;
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, PNG.sync.write(png));
  return filePath;
}

/* ------------------------------------------------------------------ *
 * Overlay geometry / zoom
 * ------------------------------------------------------------------ */

export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Apply a CSS zoom factor to the document root. */
export async function setPageZoom(page: Page, zoom: number): Promise<void> {
  await page.evaluate((z) => {
    (document.documentElement.style as any).zoom = String(z);
  }, zoom);
  await page.waitForTimeout(400);
}

/**
 * Read the first initials overlay rect, normalized against the rendered
 * PDF page box, so the value is comparable across zoom levels.
 */
export async function initialsOverlayRect(page: Page): Promise<NormalizedRect> {
  const overlay = page
    .locator('[data-field-overlay="true"]')
    .filter({ hasText: /initial/i })
    .first();
  const target = (await overlay.count())
    ? overlay
    : page.locator('[data-field-overlay="true"]').first();

  const box = await target.boundingBox();
  const pageBox = await page
    .locator(".react-pdf__Page, canvas")
    .first()
    .boundingBox();
  if (!box || !pageBox) throw new Error("could not measure initials overlay");
  return {
    x: (box.x - pageBox.x) / pageBox.width,
    y: (box.y - pageBox.y) / pageBox.height,
    w: box.width / pageBox.width,
    h: box.height / pageBox.height,
  };
}

/**
 * Draw initials at the given zoom level and return the normalized overlay
 * rect measured on screen (before submitting).
 */
export async function drawInitialsAtZoom(
  page: Page,
  zoom: number,
): Promise<NormalizedRect> {
  await setPageZoom(page, zoom);

  const initialsBtn = page
    .getByRole("button", { name: /click for initials|initials/i })
    .first();
  await expect(initialsBtn).toBeVisible({ timeout: 20_000 });
  await initialsBtn.click();

  const dialog = page.getByRole("dialog", { name: /adopt your initials/i });
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("initials-mode-draw").click();

  const canvas = dialog.getByTestId("initials-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("initials canvas has no bounding box");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.25, { steps: 12 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.75, { steps: 12 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3, { steps: 12 });
  await page.mouse.up();

  const adopt = dialog.getByTestId("initials-adopt");
  await expect(adopt).toBeEnabled();
  await adopt.click();
  await expect(dialog).toBeHidden();

  return initialsOverlayRect(page);
}

/** Ink ratio inside a normalized rect of a rendered PDF page. */
export async function inkRatioInRect(
  bytes: Buffer,
  rect: NormalizedRect,
  pageNumber = 1,
): Promise<number | null> {
  const rendered = await renderPdfPageToPng(bytes, pageNumber, 1200);
  if (!rendered) return null;
  const crop = await cropRegion(rendered, rect);
  return inkRatio(crop);
}

/* ------------------------------------------------------------------ *
 * Completion events (duplicate / out-of-order tolerance)
 * ------------------------------------------------------------------ */

export interface CompletionEventOptions {
  supabaseUrl: string;
  anonKey: string;
  documentId: string;
  /** Optional edge-function name that handles completion notifications. */
  functionName?: string;
  /** Arbitrary extra payload, used to fake stale/out-of-order deliveries. */
  payload?: Record<string, unknown>;
}

/** Read the current document status (or null when unreadable). */
export async function pollDocumentStatus(
  opts: Pick<CompletionEventOptions, "supabaseUrl" | "anonKey" | "documentId">,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${opts.supabaseUrl}/rest/v1/documents?id=eq.${opts.documentId}&select=status`,
      { headers: { apikey: opts.anonKey, Authorization: `Bearer ${opts.anonKey}` } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ status?: string }>;
    return rows?.[0]?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * Fire a completion event at the backend. Duplicate and stale deliveries are
 * expected to be no-ops; the helper returns the HTTP status so specs can
 * assert nothing 5xx'd.
 */
export async function fireCompletionEvent(
  opts: CompletionEventOptions,
): Promise<number> {
  const fn = opts.functionName || "finalize-document";
  try {
    const res = await fetch(`${opts.supabaseUrl}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: opts.anonKey,
        Authorization: `Bearer ${opts.anonKey}`,
      },
      body: JSON.stringify({ documentId: opts.documentId, ...(opts.payload || {}) }),
    });
    return res.status;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * Embedded image ordering (drawn / uploaded marks)
 * ------------------------------------------------------------------ */

/**
 * Return byte offsets of embedded image XObjects, in file order. Drawn marks
 * carry no extractable text, so ordering assertions use these offsets.
 */
export function extractImageXObjectOrder(bytes: Buffer): number[] {
  const raw = bytes.toString("latin1");
  const offsets: number[] = [];
  const re = /\/Subtype\s*\/Image/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) offsets.push(m.index);
  return offsets;
}

/* ------------------------------------------------------------------ *
 * Retry / timeout delivery helpers
 * ------------------------------------------------------------------ */

/**
 * Fire a completion event but abort the request after `timeoutMs`, simulating
 * a webhook delivery that times out on the sender side and gets retried.
 * Returns the HTTP status, or 0 when the delivery was aborted.
 */
export async function fireCompletionEventWithTimeout(
  opts: CompletionEventOptions & { timeoutMs: number },
): Promise<number> {
  const fn = opts.functionName || "finalize-document";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`${opts.supabaseUrl}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: opts.anonKey,
        Authorization: `Bearer ${opts.anonKey}`,
      },
      body: JSON.stringify({ documentId: opts.documentId, ...(opts.payload || {}) }),
      signal: controller.signal,
    });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** Count non-overlapping occurrences of `needle` in `text`. */
export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i === -1) break;
    count++;
    from = i + needle.length;
  }
  return count;
}

/** Number of embedded image XObjects in the PDF. */
export function countImageXObjects(bytes: Buffer): number {
  return extractImageXObjectOrder(bytes).length;
}

/**
 * Normalized rect for a specific field overlay, matched by index among the
 * initials overlays on the page (falls back to any field overlay).
 */
export async function signerRegionRect(
  page: Page,
  index = 0,
): Promise<NormalizedRect> {
  const initialsOverlays = page
    .locator('[data-field-overlay="true"]')
    .filter({ hasText: /initial/i });
  const target = (await initialsOverlays.count()) > index
    ? initialsOverlays.nth(index)
    : page.locator('[data-field-overlay="true"]').nth(index);

  const box = await target.boundingBox();
  const pageBox = await page
    .locator(".react-pdf__Page, canvas")
    .first()
    .boundingBox();
  if (!box || !pageBox) throw new Error(`could not measure overlay ${index}`);
  return {
    x: (box.x - pageBox.x) / pageBox.width,
    y: (box.y - pageBox.y) / pageBox.height,
    w: box.width / pageBox.width,
    h: box.height / pageBox.height,
  };
}

/** Pad a normalized rect, clamped to the page box. */
export function padRect(rect: NormalizedRect, pad = 0.02): NormalizedRect {
  return {
    x: Math.max(0, rect.x - pad),
    y: Math.max(0, rect.y - pad),
    w: Math.min(1, rect.w + pad * 2),
    h: Math.min(1, rect.h + pad * 2),
  };
}

/** A region well away from `rect`, used as an ink control. */
export function controlRect(rect: NormalizedRect): NormalizedRect {
  return {
    x: Math.min(0.9, (rect.x + 0.45) % 0.9),
    y: Math.min(0.9, (rect.y + 0.45) % 0.9),
    w: rect.w,
    h: rect.h,
  };
}

// Flattens signatures + field values into the PDF, writes completed_file_path,
// and appends a Certificate of Completion page.
//
// Two guarantees:
//  1. Rotation aware. Field coordinates are stored as percentages of the page
//     as the browser rendered it (rotation already applied). This function maps
//     those visual coordinates back into unrotated PDF user space and rotates
//     the drawn content so it reads upright on 90/180/270 degree pages.
//  2. Exactly once. Completion events can be retried or delivered late; the
//     first call claims the document via `finalized_at` and later calls return
//     the existing path without re-rendering or re-uploading.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts, degrees, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";
import { FONT_SOURCES, DEFAULT_SIG_FONT, signatureFontSize } from "../_shared/signature-fonts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { documentId, force } = await req.json();
    if (!documentId) return json({ error: "documentId required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: doc } = await supabase.from("documents").select("*").eq("id", documentId).single();
    if (!doc?.file_path) return json({ error: "No file" }, 404);

    // ---- Idempotency claim -------------------------------------------------
    // Only the caller that flips finalized_at from null does the work. Retried
    // or delayed completion events fall through to the already-written PDF.
    if (!force) {
      const { data: claimed } = await supabase
        .from("documents")
        .update({ finalized_at: new Date().toISOString() })
        .eq("id", documentId)
        .is("finalized_at", null)
        .select("id");

      if (!claimed?.length) {
        // Someone already finalized (or is finalizing). Wait briefly for the
        // path if a concurrent call has not written it yet.
        let path = doc.completed_file_path as string | null;
        for (let i = 0; i < 10 && !path; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          const { data: fresh } = await supabase
            .from("documents").select("completed_file_path").eq("id", documentId).single();
          path = (fresh?.completed_file_path as string | null) ?? null;
        }
        if (path) {
          await supabase.from("audit_logs").insert({
            document_id: documentId,
            action: "document_finalize_skipped",
            metadata: { reason: "idempotent_skip", output_path: path },
          });
          return json({ success: true, path, idempotent: true });
        }
        // Claim held but nothing written: release so a later retry can work.
        await supabase.from("documents").update({ finalized_at: null }).eq("id", documentId);
        return json({ error: "finalize_in_progress" }, 409);
      }
    }

    try {
      const path = await renderAndUpload(supabase, doc, documentId);
      return json({ success: true, path });
    } catch (e) {
      // Release the claim so a retry can finalize.
      if (!force) {
        await supabase.from("documents").update({ finalized_at: null }).eq("id", documentId);
      }
      throw e;
    }
  } catch (err: any) {
    console.error("finalize-document error", err);
    return json({ error: err.message }, 500);
  }
});

async function renderAndUpload(supabase: any, doc: any, documentId: string): Promise<string> {
  const { data: fileBlob, error: dlErr } = await supabase.storage.from("documents").download(doc.file_path);
  if (dlErr || !fileBlob) throw dlErr || new Error("download failed");
  const arrayBuf = await fileBlob.arrayBuffer();

  const pdf = await PDFDocument.load(arrayBuf);
  pdf.registerFontkit(fontkit);
  const pages = pdf.getPages();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Lazy-load & cache signature fonts by css key
  const sigFontCache = new Map<string, any>();
  const getSignatureFont = async (cssKey?: string) => {
    const key = cssKey && FONT_SOURCES[cssKey] ? cssKey : DEFAULT_SIG_FONT;
    if (sigFontCache.has(key)) return sigFontCache.get(key);
    const src = FONT_SOURCES[key];
    let font;
    try {
      if (src.url) {
        const r = await fetch(src.url);
        if (!r.ok) throw new Error(`font fetch ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        font = await pdf.embedFont(buf, { subset: true });
      } else if (src.standard) {
        font = await pdf.embedFont(StandardFonts[src.standard]);
      }
    } catch (e) {
      console.error("font load failed, falling back to HelveticaBold", key, e);
      font = helvBold;
    }
    sigFontCache.set(key, font);
    return font;
  };

  const { data: fields } = await supabase.from("document_fields").select("*").eq("document_id", documentId);
  const { data: signers } = await supabase
    .from("document_signers").select("*").eq("document_id", documentId).order("signing_order");
  const signerFontById = new Map<string, string>();
  for (const s of signers || []) {
    if (s.signature_font) signerFontById.set(s.id, s.signature_font);
  }

  for (const f of fields || []) {
    const pageIdx = (f.page_number || 1) - 1;
    const page = pages[pageIdx];
    if (!page) continue;

    const { width: pw, height: ph } = page.getSize();
    const rot = (((page.getRotation()?.angle ?? 0) % 360) + 360) % 360;
    const swapped = rot === 90 || rot === 270;
    // Page box as the browser rendered it (rotation applied).
    const vw = swapped ? ph : pw;
    const vh = swapped ? pw : ph;

    const fx = (f.x_pct ?? 0) * vw;      // from visual left
    const fyTop = (f.y_pct ?? 0) * vh;   // from visual top
    const w = (f.w_pct ?? 0.2) * vw;
    const h = (f.h_pct ?? 0.05) * vh;

    // Map a point in visual space (origin top-left, y down) to PDF user space.
    const toUser = (ax: number, ay: number): { x: number; y: number } => {
      switch (rot) {
        case 90: return { x: ay, y: ax };
        case 180: return { x: pw - ax, y: ay };
        case 270: return { x: pw - ay, y: ph - ax };
        default: return { x: ax, y: ph - ay };
      }
    };
    // Content rotation that makes the drawing read upright on a rotated page.
    const contentRotation = degrees(rot);

    if (f.type === "signature" || f.type === "initials") {
      const sig = f.signature_data;
      if (sig?.method === "type" && f.value) {
        // Font resolution: per-field -> signer envelope default -> DEFAULT
        const fontKey = sig?.font || signerFontById.get(f.signer_id) || DEFAULT_SIG_FONT;
        const sigFont = await getSignatureFont(fontKey);
        const size = signatureFontSize(h, f.type === "initials");
        const p = toUser(fx + 4, fyTop + h - h * 0.2);
        page.drawText(String(f.value), {
          x: p.x, y: p.y, size,
          font: sigFont, color: rgb(0.07, 0.14, 0.29),
          rotate: contentRotation,
        });
      } else if ((sig?.method === "draw" || sig?.method === "upload") && sig?.image) {
        try {
          const dataUrl: string = sig.image;
          const commaIdx = dataUrl.indexOf(",");
          const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const isPng = dataUrl.startsWith("data:image/png") || !dataUrl.startsWith("data:image/jpeg");
          const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
          const scaled = img.scaleToFit(w, h);
          // Centre the image inside the field box, in visual coordinates.
          const p = toUser(fx + (w - scaled.width) / 2, fyTop + h - (h - scaled.height) / 2);
          page.drawImage(img, {
            x: p.x, y: p.y, width: scaled.width, height: scaled.height,
            rotate: contentRotation,
          });
        } catch (e) { console.error("sig embed failed", e); }
      }
    } else if (f.type === "checkbox") {
      // Draw box outline always; add a check glyph when value === "true".
      const box = toUser(fx, fyTop + h);
      page.drawRectangle({
        x: box.x, y: box.y, width: w, height: h,
        borderColor: rgb(0.11, 0.16, 0.29), borderWidth: 0.8,
        rotate: contentRotation,
      });
      if (String(f.value) === "true") {
        const size = Math.min(w, h) * 0.9;
        const p = toUser(fx + (w - size * 0.5) / 2, fyTop + h - (h - size * 0.7) / 2);
        page.drawText("X", {
          x: p.x, y: p.y, size, font: helvBold, color: rgb(0.07, 0.14, 0.29),
          rotate: contentRotation,
        });
      }
    } else if (f.value) {
      const p = toUser(fx + 3, fyTop + h - h * 0.3);
      page.drawText(String(f.value), {
        x: p.x, y: p.y, size: Math.min(h * 0.65, 12),
        font: helv, color: rgb(0.07, 0.14, 0.29),
        rotate: contentRotation,
      });
    }
  }

  // Certificate of Completion
  const cert = pdf.addPage([612, 792]);
  let yy = 740;
  cert.drawText("Certificate of Completion", { x: 50, y: yy, size: 20, font: helvBold, color: rgb(0.11, 0.16, 0.29) });
  yy -= 30;
  cert.drawText(`Document: ${doc.title}`, { x: 50, y: yy, size: 11, font: helv });
  yy -= 16;
  cert.drawText(`Document ID: ${doc.id}`, { x: 50, y: yy, size: 10, font: helv });
  yy -= 16;
  cert.drawText(`Completed at: ${new Date().toISOString()}`, { x: 50, y: yy, size: 10, font: helv });
  yy -= 28;
  cert.drawText("Signers:", { x: 50, y: yy, size: 13, font: helvBold });
  yy -= 20;
  for (const s of signers || []) {
    cert.drawText(`• ${s.name || ""} <${s.email}>`, { x: 60, y: yy, size: 11, font: helvBold });
    yy -= 14;
    cert.drawText(`  Status: ${s.status} | Signed: ${s.signed_at || "-"} | IP: ${s.ip_address || "-"}`,
      { x: 60, y: yy, size: 9, font: helv, color: rgb(0.3, 0.3, 0.3) });
    yy -= 20;
    if (yy < 80) break;
  }

  const outBytes = await pdf.save();
  const outPath = doc.file_path.replace(/(\.[^.]+)?$/, "-signed.pdf");
  const { error: upErr } = await supabase.storage.from("documents").upload(outPath, outBytes, {
    contentType: "application/pdf", upsert: true,
  });
  if (upErr) throw upErr;

  await supabase.from("documents").update({ completed_file_path: outPath }).eq("id", documentId);
  await supabase.from("audit_logs").insert({
    document_id: documentId, action: "document_finalized",
    metadata: { output_path: outPath },
  });

  return outPath;
}

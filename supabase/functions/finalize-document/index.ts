// Flattens signatures + field values into the PDF, writes completed_file_path,
// and appends a Certificate of Completion page.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";

// Map SignDocument.tsx SIGNATURE_FONTS css → downloadable TTF (script fonts) or standard font key.
const FONT_SOURCES: Record<string, { url?: string; standard?: keyof typeof StandardFonts }> = {
  "'Dancing Script', cursive": { url: "https://raw.githubusercontent.com/google/fonts/main/ofl/dancingscript/static/DancingScript-Regular.ttf" },
  "'Great Vibes', cursive": { url: "https://raw.githubusercontent.com/google/fonts/main/ofl/greatvibes/GreatVibes-Regular.ttf" },
  "'Pacifico', cursive": { url: "https://raw.githubusercontent.com/google/fonts/main/ofl/pacifico/Pacifico-Regular.ttf" },
  "'Times New Roman', Times, serif": { standard: "TimesRomanBold" },
  "Georgia, serif": { standard: "TimesRomanBold" },
  "'Courier New', Courier, monospace": { standard: "CourierBold" },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { documentId } = await req.json();
    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: doc } = await supabase.from("documents").select("*").eq("id", documentId).single();
    if (!doc?.file_path) {
      return new Response(JSON.stringify({ error: "No file" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      const key = cssKey && FONT_SOURCES[cssKey] ? cssKey : "'Dancing Script', cursive";
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
    const { data: signers } = await supabase.from("document_signers").select("*").eq("document_id", documentId).order("signing_order");

    for (const f of fields || []) {
      const pageIdx = (f.page_number || 1) - 1;
      const page = pages[pageIdx];
      if (!page) continue;
      const { width: pw, height: ph } = page.getSize();
      const x = (f.x_pct ?? 0) * pw;
      const yTop = (f.y_pct ?? 0) * ph;
      const w = (f.w_pct ?? 0.2) * pw;
      const h = (f.h_pct ?? 0.05) * ph;
      const y = ph - yTop - h; // pdf-lib origin is bottom-left

      if (f.type === "signature") {
        const sig = f.signature_data;
        if (sig?.method === "type" && f.value) {
          const sigFont = await getSignatureFont(sig?.font);
          const size = Math.min(h * 0.85, 28);
          page.drawText(String(f.value), {
            x: x + 4, y: y + h * 0.2, size,
            font: sigFont, color: rgb(0.07, 0.14, 0.29),
          });
        } else if ((sig?.method === "draw" || sig?.method === "upload") && sig?.image) {
          try {
            const dataUrl: string = sig.image;
            const commaIdx = dataUrl.indexOf(",");
            const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const isPng = dataUrl.startsWith("data:image/png") || !dataUrl.startsWith("data:image/jpeg");
            const img = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
            const scaled = img.scaleToFit(w, h);
            page.drawImage(img, { x: x + (w - scaled.width) / 2, y: y + (h - scaled.height) / 2, width: scaled.width, height: scaled.height });
          } catch (e) { console.error("sig embed failed", e); }
        }
      } else if (f.value) {
        page.drawText(String(f.value), {
          x: x + 3, y: y + h * 0.3, size: Math.min(h * 0.65, 12),
          font: helv, color: rgb(0.07, 0.14, 0.29),
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

    return new Response(JSON.stringify({ success: true, path: outPath }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("finalize-document error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

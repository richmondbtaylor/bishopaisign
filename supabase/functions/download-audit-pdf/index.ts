import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";
import { FONT_SOURCES, DEFAULT_SIG_FONT } from "../_shared/signature-fonts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub;

    const url = new URL(req.url);
    const documentId = url.searchParams.get("documentId");
    if (!documentId) {
      return new Response(JSON.stringify({ error: "documentId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: doc } = await admin.from("documents").select("*").eq("id", documentId).maybeSingle();
    if (!doc || doc.sender_id !== userId) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: logs } = await admin.from("audit_logs")
      .select("*").eq("document_id", documentId).order("created_at", { ascending: true });
    const { data: signers } = await admin.from("document_signers")
      .select("name, email, status, signing_order, signature_font").eq("document_id", documentId).order("signing_order");

    // Start from the completed (flattened) signed PDF so the audit output is
    // pixel-identical to the "Download Signed PDF" body. Fall back to the
    // original upload, then to an empty document.
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const signedPath = doc.completed_file_path || doc.file_path;
    if (signedPath) {
      try {
        const { data: blob } = await admin.storage.from("documents").download(signedPath);
        if (blob) {
          const src = await PDFDocument.load(await blob.arrayBuffer());
          const copied = await pdf.copyPages(src, src.getPageIndices());
          copied.forEach(p => pdf.addPage(p));
        }
      } catch (e) {
        console.error("audit: could not merge signed pdf", e);
      }
    }

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Lazy-load signature preview fonts so signer summaries match the signed PDF.
    const sigFontCache = new Map<string, any>();
    const getSignatureFont = async (cssKey?: string) => {
      const key = cssKey && FONT_SOURCES[cssKey] ? cssKey : DEFAULT_SIG_FONT;
      if (sigFontCache.has(key)) return sigFontCache.get(key);
      const src = FONT_SOURCES[key];
      let f: any = bold;
      try {
        if (src.url) {
          const r = await fetch(src.url);
          if (r.ok) f = await pdf.embedFont(new Uint8Array(await r.arrayBuffer()), { subset: true });
        } else if (src.standard) {
          f = await pdf.embedFont(StandardFonts[src.standard]);
        }
      } catch (e) { console.error("audit font load failed", key, e); }
      sigFontCache.set(key, f);
      return f;
    };

    let page = pdf.addPage([612, 792]);
    let y = 750;
    const drawLine = (text: string, size = 10, f = font, color = rgb(0.1, 0.1, 0.1)) => {
      if (y < 40) { page = pdf.addPage([612, 792]); y = 750; }
      page.drawText(text, { x: 40, y, size, font: f, color, maxWidth: 532 });
      y -= size + 6;
    };

    drawLine("Certificate of Audit Trail", 20, bold, rgb(0.106, 0.165, 0.29));
    drawLine(`Document: ${doc.title}`, 12, bold);
    drawLine(`Document ID: ${doc.id}`, 9);
    drawLine(`Status: ${doc.status}`, 9);
    drawLine(`Generated: ${new Date().toUTCString()}`, 9);
    y -= 8;
    drawLine("Signers", 13, bold);
    for (const s of signers || []) {
      drawLine(`${s.signing_order}. ${s.name || "(no name)"} <${s.email}> - ${s.status}`, 10);
      if (s.status === "signed" && s.name) {
        const sf = await getSignatureFont(s.signature_font || undefined);
        if (y < 40) { page = pdf.addPage([612, 792]); y = 750; }
        page.drawText(s.name, { x: 60, y, size: 16, font: sf, color: rgb(0.07, 0.14, 0.29) });
        y -= 22;
      }
    }
    y -= 8;
    drawLine("Event Log", 13, bold);
    (logs || []).forEach((l: any) => {
      const when = new Date(l.created_at).toISOString().replace("T", " ").slice(0, 19);
      const actor = l.actor_email ? ` by ${l.actor_email}` : "";
      const ip = l.ip_address ? ` [${l.ip_address}]` : "";
      drawLine(`${when} UTC - ${l.action}${actor}${ip}`, 9);
      if (l.metadata && Object.keys(l.metadata).length) {
        drawLine(`   ${JSON.stringify(l.metadata)}`, 8, font, rgb(0.4, 0.4, 0.4));
      }
    });

    const bytes = await pdf.save();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="audit-${doc.id.slice(0, 8)}.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("download-audit-pdf error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

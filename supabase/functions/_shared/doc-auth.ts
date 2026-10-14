import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function authAdmin(req: Request): Promise<{ admin: SupabaseClient; userId: string; email: string | null } | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ error: "Unauthorized" }, 401);
  return { admin, userId: data.user.id, email: data.user.email ?? null };
}

const ACTIVE = ["sent", "partially_signed", "completed", "draft", "expired", "declined"];

/** Voids a document: rotates signer tokens, stamps the PDF, logs, emails signers. */
export async function voidDocument(
  admin: SupabaseClient,
  doc: { id: string; title: string; status: string; file_path: string | null; completed_file_path: string | null; sender_id: string },
  actor: { userId: string; email: string | null },
  reason: string,
  notify: boolean,
) {
  if (!ACTIVE.includes(doc.status)) return;
  const now = new Date().toISOString();
  let voidedPath: string | null = null;
  const source = doc.completed_file_path || doc.file_path;
  if (source && doc.status === "completed") {
    const { PDFDocument, StandardFonts, rgb, degrees } = await import("https://esm.sh/pdf-lib@1.17.1");
    const { data: blob } = await admin.storage.from("documents").download(source);
    if (blob) {
      const pdf = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const reg = await pdf.embedFont(StandardFonts.Helvetica);
      const red = rgb(0.8, 0.1, 0.1);
      for (const page of pdf.getPages()) {
        const { width, height } = page.getSize();
        const size = Math.min(width, height) / 4;
        const tw = bold.widthOfTextAtSize("VOID", size);
        page.drawText("VOID", {
          x: width / 2 - (tw / 2) * Math.cos(Math.PI / 4) + (size / 3), y: height / 2 - (tw / 2) * Math.sin(Math.PI / 4),
          size, font: bold, color: red, opacity: 0.3, rotate: degrees(45),
        });
        const line = `VOIDED ${now.slice(0, 10)}${reason ? ` - ${reason}` : ""}`.slice(0, 140);
        page.drawText(line, { x: 24, y: 18, size: 9, font: reg, color: red });
      }
      voidedPath = `${doc.sender_id}/voided/${doc.id}-${Date.now()}.pdf`;
      const bytes = await pdf.save();
      const { error } = await admin.storage.from("documents").upload(voidedPath, bytes, { contentType: "application/pdf" });
      if (error) { console.error("void stamp upload failed", error); voidedPath = null; }
    }
  }

  await admin.from("documents").update({
    status: "voided", voided_at: now, voided_by: actor.userId, void_reason: reason || null, voided_file_path: voidedPath,
  }).eq("id", doc.id);

  const { data: signers } = await admin.from("document_signers").select("id, email, name").eq("document_id", doc.id);
  for (const s of signers || []) {
    await admin.from("document_signers").update({ token: crypto.randomUUID() }).eq("id", s.id);
  }
  await admin.from("audit_logs").insert({
    document_id: doc.id, action: "document_voided", actor_id: actor.userId, actor_email: actor.email,
    metadata: { reason: reason || null, previous_status: doc.status },
  });

  if (notify && doc.status !== "draft") {
    const url = Deno.env.get("SUPABASE_URL")!;
    for (const s of signers || []) {
      await fetch(`${url}/functions/v1/send-transactional-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          templateName: "signing-voided", recipientEmail: s.email, documentId: doc.id, signerId: s.id,
          idempotencyKey: `voided-${s.id}`,
          templateData: { documentTitle: doc.title, recipientName: s.name || undefined, reason: reason || undefined },
        }),
      }).catch((e) => console.error("void email failed", e));
    }
  }
}

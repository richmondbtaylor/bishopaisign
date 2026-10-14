import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.25.76";
import { authAdmin, json, voidDocument } from "../_shared/doc-auth.ts";

const Body = z.object({ documentId: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "A valid document is required." }, 400);
    const ctx = await authAdmin(req);
    if (ctx instanceof Response) return ctx;
    const { admin } = ctx;
    const { data: doc } = await admin.from("documents")
      .select("id, title, status, file_path, completed_file_path, voided_file_path, sender_id").eq("id", parsed.data.documentId).single();
    if (!doc) return json({ error: "Document not found." }, 404);
    if (doc.sender_id !== ctx.userId) return json({ error: "Forbidden" }, 403);

    // Stop any active signing first so open links die and signers are told.
    if (doc.status === "sent" || doc.status === "partially_signed") {
      await voidDocument(admin, doc, ctx, "Document deleted by sender", true);
    }

    const { data: signers } = await admin.from("document_signers").select("email").eq("document_id", doc.id);
    await admin.from("deleted_documents").insert({
      owner_id: ctx.userId, document_id: doc.id, title: doc.title, status_at_deletion: doc.status,
      signer_emails: (signers || []).map((s: { email: string }) => s.email),
    });

    // Remove generated files. The original upload is kept if another document or the saved library uses it.
    const paths = [doc.completed_file_path, doc.voided_file_path].filter(Boolean) as string[];
    if (doc.file_path) {
      const [{ count: otherDocs }, { count: libraryRefs }] = await Promise.all([
        admin.from("documents").select("id", { count: "exact", head: true }).eq("file_path", doc.file_path).neq("id", doc.id),
        admin.from("saved_pdfs").select("id", { count: "exact", head: true }).eq("file_path", doc.file_path),
      ]);
      if (!otherDocs && !libraryRefs) paths.push(doc.file_path);
    }
    if (paths.length) await admin.storage.from("documents").remove(paths);

    for (const table of ["document_fields", "document_reminders", "document_ai_summaries", "email_send_log", "bulk_recipients", "audit_logs", "document_signers"]) {
      const { error } = await admin.from(table).delete().eq("document_id", doc.id);
      if (error) console.warn(`cleanup ${table} failed`, error.message);
    }
    const { error } = await admin.from("documents").delete().eq("id", doc.id);
    if (error) throw error;
    return json({ success: true });
  } catch (e) {
    console.error("delete-document failed", e);
    return json({ error: "Could not delete the document." }, 500);
  }
});

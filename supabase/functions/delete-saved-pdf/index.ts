import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.25.76";
import { authAdmin, json } from "../_shared/doc-auth.ts";

const Body = z.object({ savedPdfId: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "A valid saved PDF is required." }, 400);
    const ctx = await authAdmin(req);
    if (ctx instanceof Response) return ctx;
    const { admin } = ctx;
    const { data: saved } = await admin.from("saved_pdfs").select("id, owner_id, file_path").eq("id", parsed.data.savedPdfId).single();
    if (!saved) return json({ error: "Saved PDF not found." }, 404);
    if (saved.owner_id !== ctx.userId) return json({ error: "Forbidden" }, 403);

    const [{ count: docRefs }, { count: otherSaved }] = await Promise.all([
      admin.from("documents").select("id", { count: "exact", head: true }).eq("file_path", saved.file_path),
      admin.from("saved_pdfs").select("id", { count: "exact", head: true }).eq("file_path", saved.file_path).neq("id", saved.id),
    ]);
    const fileRemoved = !docRefs && !otherSaved;
    if (fileRemoved) await admin.storage.from("documents").remove([saved.file_path]);
    const { error } = await admin.from("saved_pdfs").delete().eq("id", saved.id);
    if (error) throw error;
    return json({ success: true, fileRemoved, usedByDocuments: docRefs || 0 });
  } catch (e) {
    console.error("delete-saved-pdf failed", e);
    return json({ error: "Could not delete the saved PDF." }, 500);
  }
});

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.25.76";
import { authAdmin, json, voidDocument } from "../_shared/doc-auth.ts";

const Body = z.object({ documentId: z.string().uuid(), reason: z.string().trim().max(500).default("") });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return json({ error: "A valid document is required." }, 400);
    const ctx = await authAdmin(req);
    if (ctx instanceof Response) return ctx;
    const { data: doc } = await ctx.admin.from("documents")
      .select("id, title, status, file_path, completed_file_path, sender_id").eq("id", parsed.data.documentId).single();
    if (!doc) return json({ error: "Document not found." }, 404);
    if (doc.sender_id !== ctx.userId) return json({ error: "Forbidden" }, 403);
    if (doc.status === "voided") return json({ error: "This document is already voided." }, 400);
    if (doc.status === "draft") return json({ error: "Drafts can be deleted instead of voided." }, 400);
    await voidDocument(ctx.admin, doc, ctx, parsed.data.reason, true);
    return json({ success: true });
  } catch (e) {
    console.error("void-document failed", e);
    return json({ error: "Could not void the document." }, 500);
  }
});

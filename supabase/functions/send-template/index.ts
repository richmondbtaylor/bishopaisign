// Send a template to recipients by email only.
// Creates one document per email address from the template (copying the
// template's fields, including initials fields, with their percentage
// coordinates intact), then dispatches the signing invite.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const user = userData.user;

    const body = await req.json();
    const templateId = body?.templateId;
    const rawEmails = Array.isArray(body?.emails) ? body.emails : [];
    const origin = body?.origin;

    if (!templateId || rawEmails.length === 0) {
      return json({ error: "templateId and emails[] required" }, 400);
    }
    if (rawEmails.length > 50) {
      return json({ error: "Max 50 recipients per send" }, 400);
    }

    const emails = Array.from(
      new Set(
        rawEmails
          .map((e: unknown) => String(e || "").trim().toLowerCase())
          .filter((e: string) => EMAIL_RX.test(e)),
      ),
    ) as string[];
    if (emails.length === 0) return json({ error: "No valid email addresses" }, 400);

    const { data: template, error: tplErr } = await admin
      .from("templates").select("*").eq("id", templateId).single();
    if (tplErr || !template) return json({ error: "Template not found" }, 404);
    if (template.creator_id !== user.id) return json({ error: "Forbidden" }, 403);

    const { data: templateFields } = await admin
      .from("template_fields").select("*").eq("template_id", templateId);

    const normalizedOrigin = typeof origin === "string" && /^https?:\/\//.test(origin)
      ? origin.replace(/\/$/, "")
      : "https://bishopaisign.lovable.app";

    const results: Array<{ email: string; ok: boolean; documentId?: string; error?: string }> = [];

    for (const email of emails) {
      try {
        const { data: doc, error: docErr } = await admin.from("documents").insert({
          title: `${template.name} - ${email}`,
          sender_id: user.id,
          organization_id: template.organization_id,
          file_path: template.file_path,
          template_id: template.id,
          status: "draft",
          signing_mode: "parallel",
        }).select().single();
        if (docErr) throw docErr;

        const { data: signer, error: sErr } = await admin.from("document_signers").insert({
          document_id: doc.id,
          email,
          signing_order: 1,
          status: "sent",
        }).select().single();
        if (sErr) throw sErr;

        if (templateFields?.length) {
          const { error: fErr } = await admin.from("document_fields").insert(
            templateFields.map((f: any) => ({
              document_id: doc.id,
              signer_id: signer.id,
              type: f.type,
              x: f.x, y: f.y, width: f.width, height: f.height,
              x_pct: f.x_pct, y_pct: f.y_pct, w_pct: f.w_pct, h_pct: f.h_pct,
              page_number: f.page_number,
              label: f.label, required: f.required, placeholder: f.placeholder,
              options: f.options,
            })),
          );
          if (fErr) throw fErr;
        }

        // send-sign-request enforces plan limits and flips the document to sent.
        const inviteRes = await fetch(`${supabaseUrl}/functions/v1/send-sign-request`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ documentId: doc.id, origin: normalizedOrigin }),
        });
        if (!inviteRes.ok) {
          const payload = await inviteRes.json().catch(() => ({}));
          throw new Error(payload?.message || payload?.error || `invite failed (${inviteRes.status})`);
        }

        await admin.from("documents").update({ status: "sent" }).eq("id", doc.id);
        results.push({ email, ok: true, documentId: doc.id });
      } catch (e: any) {
        console.error("send-template row failed", email, e);
        results.push({ email, ok: false, error: e?.message || "unknown error" });
      }
    }

    return json({
      success: true,
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err: any) {
    console.error("send-template error", err);
    return json({ error: err.message }, 500);
  }
});

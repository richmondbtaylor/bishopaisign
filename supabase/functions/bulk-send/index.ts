// Bulk send: creates a document per CSV row from a template, copies template
// fields, inserts signers, and enqueues invite emails via send-sign-request.
// Business plan only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Row = { name?: string; email: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const user = userData.user;

    const { templateId, rows, origin } = await req.json();
    if (!templateId || !Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: "templateId and rows[] required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (rows.length > 500) {
      return new Response(JSON.stringify({ error: "Max 500 rows per batch" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Business plan gate
    const { data: sub } = await admin
      .from("subscriptions")
      .select("plan, status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const plan = sub?.plan as string | undefined;
    const active = sub && ["active", "trialing", "past_due"].includes(sub.status as string);
    if (!active || plan !== "business") {
      return new Response(JSON.stringify({ error: "upgrade_required", plan: "business" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate rows
    const valid: Row[] = [];
    for (const r of rows) {
      const email = String(r?.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      valid.push({ name: (r.name || "").toString().trim() || undefined, email });
    }
    if (valid.length === 0) {
      return new Response(JSON.stringify({ error: "No valid rows" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: template, error: tplErr } = await admin
      .from("templates").select("*").eq("id", templateId).single();
    if (tplErr || !template) throw tplErr || new Error("Template not found");

    const { data: templateFields } = await admin
      .from("template_fields").select("*").eq("template_id", templateId);

    // Create batch
    const { data: batch, error: batchErr } = await admin.from("bulk_batches").insert({
      template_id: templateId, sender_id: user.id, row_count: valid.length, status: "processing",
    }).select().single();
    if (batchErr) throw batchErr;

    const normalizedOrigin = typeof origin === "string" && /^https?:\/\//.test(origin)
      ? origin.replace(/\/$/, "") : "https://bishopaisign.lovable.app";

    let created = 0;
    let failed = 0;

    for (const row of valid) {
      try {
        const { data: doc, error: docErr } = await admin.from("documents").insert({
          title: `${template.name} - ${row.name || row.email}`,
          sender_id: user.id,
          file_path: template.file_path,
          template_id: template.id,
          status: "draft",
          signing_mode: "parallel",
        }).select().single();
        if (docErr) throw docErr;

        const { data: insertedSigner, error: sErr } = await admin.from("document_signers").insert({
          document_id: doc.id, email: row.email, name: row.name || null,
          signing_order: 1, status: "sent",
        }).select().single();
        if (sErr) throw sErr;

        if (templateFields?.length) {
          await admin.from("document_fields").insert(
            templateFields.map((f: any) => ({
              document_id: doc.id,
              type: f.type,
              x: f.x, y: f.y, width: f.width, height: f.height,
              x_pct: (f as any).x_pct, y_pct: (f as any).y_pct,
              w_pct: (f as any).w_pct, h_pct: (f as any).h_pct,
              page_number: f.page_number,
              label: f.label, required: f.required, placeholder: f.placeholder,
              options: f.options,
              signer_id: insertedSigner.id,
            }))
          );
        }

        await admin.from("documents").update({ status: "sent" }).eq("id", doc.id);
        await admin.from("bulk_recipients").insert({
          batch_id: batch.id, document_id: doc.id,
          name: row.name || null, email: row.email, status: "sent",
        });

        // Fire invite (fire-and-forget; failures logged in send-sign-request)
        fetch(`${supabaseUrl}/functions/v1/send-sign-request`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ documentId: doc.id, origin: normalizedOrigin }),
        }).catch((e) => console.error("invite dispatch failed", e));

        created++;
      } catch (e: any) {
        failed++;
        console.error("bulk row failed", row.email, e);
        await admin.from("bulk_recipients").insert({
          batch_id: batch.id, name: row.name || null, email: row.email,
          status: "failed", error: e?.message || "unknown",
        });
      }
    }

    await admin.from("bulk_batches").update({ status: failed === 0 ? "completed" : "completed_with_errors" }).eq("id", batch.id);

    return new Response(JSON.stringify({ success: true, batchId: batch.id, created, failed }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("bulk-send error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

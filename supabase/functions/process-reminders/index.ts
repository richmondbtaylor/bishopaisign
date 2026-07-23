// Cron-invoked: scans document_reminders for due, unsent items, sends via
// send-transactional-email using the "reminder" template, marks them sent.
// Skips reminders for signers who already signed or documents that are
// completed/declined/expired.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const { data: due } = await admin
      .from("document_reminders")
      .select("*")
      .is("sent_at", null)
      .lte("scheduled_for", new Date().toISOString())
      .limit(50);

    let sent = 0, skipped = 0, failed = 0;

    for (const r of due || []) {
      try {
        const { data: doc } = await admin.from("documents").select("*").eq("id", r.document_id).single();
        if (!doc || ["completed", "declined", "expired"].includes(doc.status)) {
          await admin.from("document_reminders").update({ sent_at: new Date().toISOString() }).eq("id", r.id);
          skipped++; continue;
        }
        const { data: signer } = await admin.from("document_signers").select("*").eq("id", r.signer_id).single();
        if (!signer || signer.status === "signed" || signer.status === "declined") {
          await admin.from("document_reminders").update({ sent_at: new Date().toISOString() }).eq("id", r.id);
          skipped++; continue;
        }

        const { data: senderProfile } = await admin.from("profiles")
          .select("full_name").eq("user_id", doc.sender_id).maybeSingle();
        const senderName = senderProfile?.full_name || "BishopAI Sign";
        const signingUrl = `https://bishopaisign.lovable.app/sign/${doc.id}?token=${signer.token}`;

        const resp = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            templateName: "reminder",
            recipientEmail: signer.email,
            documentId: doc.id,
            signerId: signer.id,
            idempotencyKey: `reminder-${r.id}`,
            templateData: {
              senderName,
              documentTitle: doc.title,
              signingUrl,
              recipientName: signer.name || undefined,
            },
          }),
        });
        if (!resp.ok) throw new Error(`send failed ${resp.status}`);

        await admin.from("document_reminders").update({ sent_at: new Date().toISOString() }).eq("id", r.id);
        await admin.from("audit_logs").insert({
          document_id: doc.id, action: "reminder_sent",
          actor_email: signer.email, metadata: { attempt: r.attempt },
        });
        sent++;
      } catch (e: any) {
        console.error("reminder failed", r.id, e);
        failed++;
      }
    }

    return new Response(JSON.stringify({ sent, skipped, failed, total: due?.length || 0 }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("process-reminders error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

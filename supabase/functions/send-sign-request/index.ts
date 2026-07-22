import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { documentId, origin, onlySignerOrder } = await req.json();

    if (!documentId || !origin) {
      return new Response(
        JSON.stringify({ error: "documentId and origin are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: doc } = await supabase.from("documents").select("*").eq("id", documentId).single();
    if (!doc) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get sender name for template
    const { data: senderProfile } = await supabase
      .from("profiles").select("full_name").eq("user_id", doc.sender_id).maybeSingle();
    const senderName = senderProfile?.full_name || "A BishopAI Sign user";

    const { data: signers } = await supabase
      .from("document_signers").select("*").eq("document_id", documentId).order("signing_order");

    if (!signers?.length) {
      return new Response(JSON.stringify({ error: "No signers found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let signersToNotify = signers;
    if (typeof onlySignerOrder === "number") {
      signersToNotify = signers.filter((s: any) => s.signing_order === onlySignerOrder);
    } else if (doc.signing_mode === "sequential") {
      const next = signers.find((s: any) => s.status !== "signed");
      signersToNotify = next ? [next] : [];
    }

    const results = [];

    for (const signer of signersToNotify) {
      const signingUrl = `${origin}/sign/${signer.token}`;

      // Send transactional email through the queued pipeline
      const emailResp = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          templateName: "signing-invite",
          recipientEmail: signer.email,
          documentId,
          signerId: signer.id,
          idempotencyKey: `invite-${signer.id}-${Date.now()}`,
          templateData: {
            signerName: signer.name || signer.email,
            senderName,
            documentTitle: doc.title,
            signingUrl,
            expiresAt: doc.expires_at,
          },
        }),
      });

      let emailStatus = "queued";
      let emailError: string | undefined;
      if (!emailResp.ok) {
        emailStatus = "failed";
        emailError = await emailResp.text();
        console.error("send-transactional-email failed", { status: emailResp.status, body: emailError });
      }

      await supabase.from("audit_logs").insert({
        document_id: documentId,
        action: "signing_link_sent",
        actor_email: signer.email,
        metadata: {
          signer_id: signer.id,
          signing_url: signingUrl,
          signer_name: signer.name,
          email_status: emailStatus,
          email_error: emailError,
        },
      });

      results.push({ email: signer.email, status: emailStatus, url: signingUrl, error: emailError });
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("send-sign-request error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

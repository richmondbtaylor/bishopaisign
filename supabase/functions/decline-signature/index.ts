import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { token, reason } = await req.json();
    if (!token || typeof token !== "string" || !reason || typeof reason !== "string") {
      return new Response(JSON.stringify({ error: "token and reason required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const trimmedReason = reason.trim().slice(0, 1000);
    if (!trimmedReason) {
      return new Response(JSON.stringify({ error: "reason required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: signer } = await supabase
      .from("document_signers")
      .select("id, document_id, status, email")
      .eq("token", token)
      .maybeSingle();

    if (!signer) {
      return new Response(JSON.stringify({ error: "Invalid link" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (signer.status === "signed" || signer.status === "declined") {
      return new Response(JSON.stringify({ error: "Already processed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

    await supabase.from("document_signers").update({
      status: "declined",
      declined_at: new Date().toISOString(),
      decline_reason: trimmedReason,
      ip_address: ip,
    }).eq("id", signer.id);

    await supabase.from("documents").update({
      status: "declined",
      decline_reason: trimmedReason,
      declined_by_signer_id: signer.id,
    }).eq("id", signer.document_id);

    await supabase.from("audit_logs").insert({
      document_id: signer.document_id,
      action: "document_declined",
      actor_email: signer.email,
      ip_address: ip,
      metadata: { signer_id: signer.id, reason: trimmedReason },
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("decline-signature error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

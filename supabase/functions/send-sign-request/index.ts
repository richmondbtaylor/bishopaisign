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
    const { documentId, origin } = await req.json();

    if (!documentId || !origin) {
      return new Response(
        JSON.stringify({ error: "documentId and origin are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch document
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docErr || !doc) {
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch signers
    const { data: signers, error: signerErr } = await supabase
      .from("document_signers")
      .select("*")
      .eq("document_id", documentId)
      .order("signing_order");

    if (signerErr || !signers?.length) {
      return new Response(
        JSON.stringify({ error: "No signers found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine which signers to notify
    const signersToNotify = doc.signing_mode === "sequential"
      ? [signers[0]] // Only first signer in sequential mode
      : signers; // All signers in parallel mode

    const results = [];

    for (const signer of signersToNotify) {
      const signingUrl = `${origin}/sign/${signer.token}`;

      // For now, log the signing link (email sending requires email domain setup)
      console.log(`Signing link for ${signer.email}: ${signingUrl}`);

      // Log audit event
      await supabase.from("audit_logs").insert({
        document_id: documentId,
        action: "signing_link_sent",
        actor_email: signer.email,
        metadata: {
          signer_id: signer.id,
          signing_url: signingUrl,
          signer_name: signer.name,
        },
      });

      results.push({
        email: signer.email,
        status: "link_generated",
        url: signingUrl,
      });
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error in send-sign-request:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { documentId, token, email, origin } = await req.json();
    if ((!documentId && !token) || !email || !origin) {
      return new Response(
        JSON.stringify({ error: "documentId or token, email and origin are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const normalizedEmail = String(email).trim().toLowerCase();

    let resolvedDocumentId = documentId || null;

    if (!resolvedDocumentId && token) {
      const { data: tokenSigner } = await supabase
        .from("document_signers")
        .select("document_id")
        .eq("token", token)
        .maybeSingle();
      resolvedDocumentId = tokenSigner?.document_id ?? null;
    }

    if (!resolvedDocumentId && token) {
      const { data: linkLog } = await supabase
        .from("audit_logs")
        .select("document_id")
        .filter("metadata->>signing_url", "ilike", `%${token}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      resolvedDocumentId = linkLog?.document_id ?? null;
    }

    // Always return the same shape to avoid leaking which emails are on a document.
    const genericOk = new Response(
      JSON.stringify({ success: true, message: "If that email is on this document, a new link has been sent." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

    if (!resolvedDocumentId) return genericOk;

    const { data: signer } = await supabase
      .from("document_signers")
      .select("id, status, signing_order, document_id, documents(status, expires_at)")
      .eq("document_id", resolvedDocumentId)
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (!signer) return genericOk;
    if (signer.status === "signed" || signer.status === "declined") return genericOk;

    const doc: any = signer.documents;
    if (doc?.status === "completed" || doc?.status === "voided" || doc?.status === "declined") {
      return genericOk;
    }

    // Rotate the token so the old link stops working, then push a fresh invitation.
    const newToken = crypto.randomUUID();
    await supabase
      .from("document_signers")
      .update({ token: newToken, status: "sent", updated_at: new Date().toISOString() })
      .eq("id", signer.id);

    await supabase.from("audit_logs").insert({
      document_id: resolvedDocumentId,
      action: "signing_link_reissued",
      actor_email: normalizedEmail,
      metadata: { signer_id: signer.id },
    });

    await fetch(`${supabaseUrl}/functions/v1/send-sign-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ documentId: resolvedDocumentId, origin, onlySignerOrder: signer.signing_order }),
    });

    return genericOk;
  } catch (err: any) {
    console.error("request-new-link error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

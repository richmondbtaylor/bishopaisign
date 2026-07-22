import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ error: "token required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: signer, error: signerErr } = await supabase
      .from("document_signers")
      .select("*, documents(*)")
      .eq("token", token)
      .maybeSingle();

    if (signerErr || !signer) {
      return new Response(JSON.stringify({ error: "Invalid or expired link" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const document = signer.documents;

    // Mark viewed if pending
    if (signer.status === "pending" || signer.status === "sent") {
      await supabase
        .from("document_signers")
        .update({ status: "viewed", viewed_at: new Date().toISOString() })
        .eq("id", signer.id);
    }

    // Only this signer's fields (or unassigned)
    const { data: allFields } = await supabase
      .from("document_fields")
      .select("*")
      .eq("document_id", signer.document_id);

    const fields = (allFields || []).filter(
      (f: any) => !f.signer_id || f.signer_id === signer.id
    );

    let pdfUrl: string | null = null;
    if (document?.file_path) {
      const { data: signed } = await supabase.storage
        .from("documents")
        .createSignedUrl(document.file_path, 3600);
      pdfUrl = signed?.signedUrl ?? null;
    }

    // Strip sensitive fields before returning
    const safeSigner = {
      id: signer.id,
      document_id: signer.document_id,
      email: signer.email,
      name: signer.name,
      status: signer.status,
      signing_order: signer.signing_order,
      auth_method: signer.auth_method,
    };

    const safeDocument = document && {
      id: document.id,
      title: document.title,
      status: document.status,
      signing_mode: document.signing_mode,
      file_path: document.file_path,
    };

    return new Response(
      JSON.stringify({ signer: safeSigner, document: safeDocument, fields, pdfUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("signing-session error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

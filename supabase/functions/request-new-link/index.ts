import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rate limits: max 5 requests / hour per IP and per email.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 5;
const MAX_PER_EMAIL = 5;

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { documentId, token, email, origin, reason, hp_field: honeypot, challenge } = body;

    // Honeypot: real users leave hp_field empty. Bots fill every input.
    if (honeypot && String(honeypot).trim().length > 0) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Lightweight proof-of-work-ish challenge: client sends a solved math answer
    // (a + b) issued when the reissue UI mounts. Missing/wrong → treat as bot.
    if (!challenge || typeof challenge.a !== "number" || typeof challenge.b !== "number" ||
        Number(challenge.answer) !== challenge.a + challenge.b) {
      return new Response(JSON.stringify({ error: "Please complete the verification challenge." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    const ipRaw = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const ipHash = await sha256(ipRaw);
    const since = new Date(Date.now() - WINDOW_MS).toISOString();

    // Rate-limit checks (IP + email).
    const [{ count: ipCount }, { count: emailCount }] = await Promise.all([
      supabase.from("reissue_rate_limits").select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gte("created_at", since),
      supabase.from("reissue_rate_limits").select("id", { count: "exact", head: true })
        .eq("email", normalizedEmail).gte("created_at", since),
    ]);
    if ((ipCount ?? 0) >= MAX_PER_IP || (emailCount ?? 0) >= MAX_PER_EMAIL) {
      return new Response(
        JSON.stringify({ error: "Too many reissue requests. Please try again in an hour." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let resolvedDocumentId = documentId || null;
    if (!resolvedDocumentId && token) {
      const { data: tokenSigner } = await supabase
        .from("document_signers").select("document_id").eq("token", token).maybeSingle();
      resolvedDocumentId = tokenSigner?.document_id ?? null;
    }
    if (!resolvedDocumentId && token) {
      const { data: linkLog } = await supabase
        .from("audit_logs").select("document_id")
        .filter("metadata->>signing_url", "ilike", `%${token}%`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      resolvedDocumentId = linkLog?.document_id ?? null;
    }

    // Always record the attempt for rate limiting, even if we don't act on it.
    await supabase.from("reissue_rate_limits").insert({
      ip_hash: ipHash, email: normalizedEmail, document_id: resolvedDocumentId,
    });

    const genericOk = new Response(
      JSON.stringify({ success: true, message: "If that email is on this document, a new link has been sent." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

    if (!resolvedDocumentId) return genericOk;

    const { data: signer } = await supabase
      .from("document_signers")
      .select("id, status, signing_order, document_id, documents(status, expires_at)")
      .eq("document_id", resolvedDocumentId).ilike("email", normalizedEmail).maybeSingle();

    // Record the attempt with reason regardless of match — audit trail.
    await supabase.from("audit_logs").insert({
      document_id: resolvedDocumentId,
      action: "signing_link_reissue_requested",
      actor_email: normalizedEmail,
      ip_address: ipRaw !== "unknown" ? ipRaw : null,
      metadata: {
        reason: reason || "unspecified",
        matched: !!signer,
        signer_id: signer?.id ?? null,
      },
    });

    if (!signer) return genericOk;
    if (signer.status === "signed" || signer.status === "declined") return genericOk;
    const doc: any = signer.documents;
    if (doc?.status === "completed" || doc?.status === "voided" || doc?.status === "declined") return genericOk;

    const newToken = crypto.randomUUID();
    await supabase.from("document_signers")
      .update({ token: newToken, status: "sent", updated_at: new Date().toISOString() })
      .eq("id", signer.id);

    await supabase.from("audit_logs").insert({
      document_id: resolvedDocumentId,
      action: "signing_link_reissued",
      actor_email: normalizedEmail,
      ip_address: ipRaw !== "unknown" ? ipRaw : null,
      metadata: { signer_id: signer.id, reason: reason || "unspecified" },
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

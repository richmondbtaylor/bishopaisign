import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    // `signatures` (new): { [fieldId]: { method, name?, font?, image? } }
    // `signatureData` (legacy): single sig applied to every signature field
    const { token, fieldValues, signatureData, signatures, typedName } = body ?? {};

    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ error: "token required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hasPerField = signatures && typeof signatures === "object" && Object.keys(signatures).length > 0;
    if (!hasPerField && (!signatureData || typeof signatureData !== "object")) {
      return new Response(JSON.stringify({ error: "signatureData required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: signer, error: signerErr } = await supabase
      .from("document_signers")
      .select("id, document_id, status, email, signing_order, documents(signing_mode, expires_at, status)")
      .eq("token", token)
      .maybeSingle();

    if (signerErr || !signer) {
      return new Response(JSON.stringify({ error: "Invalid link" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (signer.status === "signed") {
      return new Response(JSON.stringify({ error: "Already signed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (signer.status === "declined") {
      return new Response(JSON.stringify({ error: "Signing declined" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const doc: any = signer.documents;
    // Links remain valid until the document is completed — no time-based expiration

    if (doc?.status === "declined" || doc?.status === "voided") {
      return new Response(JSON.stringify({ error: "Document not available" }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Signing order is not enforced — any signer can sign at any time


    // Load fields authorized for this signer
    const { data: allFields } = await supabase
      .from("document_fields")
      .select("id, type, signer_id")
      .eq("document_id", signer.document_id);

    const allowedFields = (allFields || []).filter(
      (f: any) => !f.signer_id || f.signer_id === signer.id
    );
    const allowedIds = new Set(allowedFields.map((f: any) => f.id));

    // Update signature fields
    const sigFields = allowedFields.filter((f: any) => f.type === "signature");
    for (const field of sigFields) {
      await supabase.from("document_fields").update({
        value: typeof typedName === "string" && typedName ? typedName : "signed",
        signature_data: signatureData,
      }).eq("id", field.id);
    }

    // Update other field values
    if (fieldValues && typeof fieldValues === "object") {
      for (const [fid, val] of Object.entries(fieldValues)) {
        if (!allowedIds.has(fid)) continue;
        if (typeof val !== "string") continue;
        await supabase.from("document_fields").update({ value: val }).eq("id", fid);
      }
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const userAgent = req.headers.get("user-agent") ?? null;

    // Concurrency-safe: only mark signed if still not signed
    const { data: updated } = await supabase.from("document_signers").update({
      status: "signed",
      signed_at: new Date().toISOString(),
      ip_address: ip,
      user_agent: userAgent,
    }).eq("id", signer.id).neq("status", "signed").select();

    if (!updated || updated.length === 0) {
      return new Response(JSON.stringify({ error: "Already processed" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update document status
    const { data: allSigners } = await supabase
      .from("document_signers")
      .select("status, signing_order, email, name")
      .eq("document_id", signer.document_id)
      .order("signing_order");

    const allSigned = allSigners?.every((s: any) => s.status === "signed");
    await supabase.from("documents").update({
      status: allSigned ? "completed" : "partially_signed",
      ...(allSigned ? { completed_at: new Date().toISOString() } : {}),
    }).eq("id", signer.document_id);

    // Audit log
    await supabase.from("audit_logs").insert({
      document_id: signer.document_id,
      action: "document_signed",
      actor_email: signer.email,
      ip_address: ip,
      user_agent: userAgent,
      metadata: { signer_id: signer.id },
    });

    // Notify next signer in sequential mode
    if (!allSigned && doc?.signing_mode === "sequential") {
      const next = allSigners?.find((s: any) => s.status !== "signed");
      if (next) {
        try {
          await supabase.functions.invoke("send-sign-request", {
            body: {
              documentId: signer.document_id,
              origin: "https://bishopaisign.lovable.app",
              onlySignerOrder: next.signing_order,
            },
          });
        } catch (e) { console.error("notify next failed", e); }
      }
    }

    // Finalize on completion + notify everyone
    if (allSigned) {
      try {
        await supabase.functions.invoke("finalize-document", {
          body: { documentId: signer.document_id },
        });
      } catch (e) { console.error("finalize failed", e); }

      try {
        // Get latest doc (with completed_file_path) and sender email
        const { data: fullDoc } = await supabase
          .from("documents")
          .select("id, title, completed_file_path, sender_id")
          .eq("id", signer.document_id)
          .single();

        let downloadUrl: string | undefined;
        if (fullDoc?.completed_file_path) {
          const { data: signed } = await supabase.storage
            .from("documents")
            .createSignedUrl(fullDoc.completed_file_path, 60 * 60 * 24 * 30); // 30 days
          downloadUrl = signed?.signedUrl;
        }

        // Recipients: all signers + sender
        const recipients: { email: string; name?: string }[] = (allSigners || [])
          .map((s: any) => ({ email: s.email, name: s.name }));

        if (fullDoc?.sender_id) {
          const { data: senderProfile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", fullDoc.sender_id)
            .maybeSingle();
          const { data: senderUser } = await supabase.auth.admin.getUserById(fullDoc.sender_id);
          const senderEmail = senderUser?.user?.email;
          if (senderEmail && !recipients.some(r => r.email.toLowerCase() === senderEmail.toLowerCase())) {
            recipients.push({ email: senderEmail, name: senderProfile?.full_name || undefined });
          }
        }

        for (const r of recipients) {
          try {
            await supabase.functions.invoke("send-transactional-email", {
              body: {
                templateName: "signing-completed",
                recipientEmail: r.email,
                idempotencyKey: `completed-${signer.document_id}-${r.email}`,
                templateData: {
                  documentTitle: fullDoc?.title || "your document",
                  recipientName: r.name,
                  downloadUrl,
                },
              },
            });
          } catch (e) { console.error("completion email failed", r.email, e); }
        }
      } catch (e) { console.error("completion notify failed", e); }
    }


    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("submit-signature error", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

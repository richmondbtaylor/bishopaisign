import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";

const BodySchema = z.object({ documentId: z.string().uuid() });
const SummarySchema = z.object({
  overview: z.string().min(1),
  clauses: z.array(z.object({ title: z.string(), explanation: z.string(), page: z.number().int().positive().nullable() })),
  deadlines: z.array(z.object({ title: z.string(), explanation: z.string(), page: z.number().int().positive().nullable() })),
  obligations: z.array(z.object({ title: z.string(), explanation: z.string(), page: z.number().int().positive().nullable() })),
});

const json = (body: unknown, status = 200, extraHeaders: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const safeGatewayMessage = (status: number, payload: unknown) => {
  const message = typeof payload === "object" && payload !== null && "message" in payload
    ? String((payload as { message?: unknown }).message || "")
    : "";
  if (status === 402) return message || "AI credits are insufficient. Add credits in Plans and credits, then try again.";
  if (status === 403) return message || "AI analysis is unavailable for this workspace.";
  if (status === 429) return "AI analysis is busy. Please wait before trying again.";
  if (status === 400) return message || "This PDF could not be analyzed.";
  return status >= 500 ? "AI analysis is temporarily unavailable." : (message || "AI analysis failed.");
};

const readOutputText = async (response: Response) => {
  if (!response.body) throw new Error("The AI response was empty.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        const parsed = JSON.parse(line.slice(6));
        if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") output += parsed.delta;
      }
    }
    if (done) break;
  }
  return output;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const parsedBody = BodySchema.safeParse(await req.json());
    if (!parsedBody.success) return json({ error: "A valid document is required." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!supabaseUrl || !serviceKey || !lovableKey) return json({ error: "AI analysis is not configured." }, 500);

    const admin = createClient(supabaseUrl, serviceKey);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

    const { data: document, error: documentError } = await admin
      .from("documents")
      .select("id, sender_id, file_path")
      .eq("id", parsedBody.data.documentId)
      .single();
    if (documentError || !document) return json({ error: "Document not found." }, 404);
    if (document.sender_id !== authData.user.id) return json({ error: "Forbidden" }, 403);
    if (!document.file_path) return json({ error: "Upload a PDF before analyzing it." }, 400);

    const { data: pdf, error: downloadError } = await admin.storage.from("documents").download(document.file_path);
    if (downloadError || !pdf) return json({ error: "The PDF could not be opened." }, 400);
    if (pdf.type && pdf.type !== "application/pdf") return json({ error: "Only PDF documents can be analyzed." }, 400);

    const gatewayResponse = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableKey}`,
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        instructions: "Analyze this agreement for its sender. Be concise and factual. Do not provide legal advice. Return page numbers only when clearly identifiable.",
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: "Return JSON containing an overview and the key clauses, deadlines, and obligations in this PDF." },
            { type: "input_file", filename: "document.pdf", file_data: `data:application/pdf;base64,${toBase64(new Uint8Array(await pdf.arrayBuffer()))}` },
          ],
        }],
        text: {
          format: {
            type: "json_schema",
            name: "document_summary",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                overview: { type: "string" },
                clauses: { type: "array", items: { $ref: "#/$defs/item" } },
                deadlines: { type: "array", items: { $ref: "#/$defs/item" } },
                obligations: { type: "array", items: { $ref: "#/$defs/item" } },
              },
              required: ["overview", "clauses", "deadlines", "obligations"],
              $defs: {
                item: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    explanation: { type: "string" },
                    page: { anyOf: [{ type: "integer" }, { type: "null" }] },
                  },
                  required: ["title", "explanation", "page"],
                },
              },
            },
          },
        },
      }),
    });

    const correlationHeaders: Record<string, string> = {};
    gatewayResponse.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("x-lovable-aig-")) correlationHeaders[key] = value;
    });
    if (!gatewayResponse.ok) {
      const payload = await gatewayResponse.json().catch(() => ({}));
      return json({ error: safeGatewayMessage(gatewayResponse.status, payload) }, gatewayResponse.status, correlationHeaders);
    }

    const output = await readOutputText(gatewayResponse);
    const summary = SummarySchema.safeParse(JSON.parse(output));
    if (!summary.success) return json({ error: "The AI response was incomplete. Please try again." }, 502, correlationHeaders);

    const { error: saveError } = await admin.from("document_ai_summaries").upsert({
      document_id: document.id,
      status: "completed",
      overview: summary.data.overview,
      clauses: summary.data.clauses,
      deadlines: summary.data.deadlines,
      obligations: summary.data.obligations,
      model: MODEL,
      error_message: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "document_id" });
    if (saveError) throw saveError;

    return json({ summary: summary.data }, 200, correlationHeaders);
  } catch (error) {
    console.error("analyze-document failed", error);
    return json({ error: "Document analysis failed." }, 500);
  }
});
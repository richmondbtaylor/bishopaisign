import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.25.76";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";
const BodySchema = z.object({ documentId: z.string().uuid() });
const TYPES = ["signature", "initials", "date", "text", "checkbox"] as const;
const ResultSchema = z.object({
  fields: z.array(z.object({
    page: z.number().int().positive(),
    type: z.enum(TYPES),
    label: z.string(),
    signer_role: z.string().nullable(),
    x_pct: z.number(), y_pct: z.number(), w_pct: z.number(), h_pct: z.number(),
  })),
});
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
  if (status === 403) return message || "Field detection is unavailable for this workspace.";
  if (status === 429) return "Field detection is busy. Please wait before trying again.";
  if (status === 400) return message || "This PDF could not be analyzed.";
  return status >= 500 ? "Field detection is temporarily unavailable." : (message || "Field detection failed.");
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
    if (!supabaseUrl || !serviceKey || !lovableKey) return json({ error: "Field detection is not configured." }, 500);
    const admin = createClient(supabaseUrl, serviceKey);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

    const { data: document } = await admin.from("documents").select("id, sender_id, file_path").eq("id", parsedBody.data.documentId).single();
    if (!document) return json({ error: "Document not found." }, 404);
    if (document.sender_id !== authData.user.id) return json({ error: "Forbidden" }, 403);
    if (!document.file_path) return json({ error: "Upload a PDF first." }, 400);
    const { data: pdf, error: downloadError } = await admin.storage.from("documents").download(document.file_path);
    if (downloadError || !pdf) return json({ error: "The PDF could not be opened." }, 400);

    const gatewayResponse = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableKey}`,
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL, stream: true, store: false,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        instructions: "You locate fillable blanks in PDF forms and agreements so an e-signature tool can place input boxes. For each blank (signature lines, initials boxes, date lines, printed name or other text blanks, checkboxes) return its page (1-based) and a bounding box as fractions (0 to 1) of the page width and height measured from the top-left corner. The box should cover the empty area where the person writes, sitting just above the underline. Use signer_role for labels like Buyer, Seller, Tenant, Client when the form says who fills it, otherwise null. Do not invent blanks that are not there.",
        input: [{ role: "user", content: [
          { type: "input_text", text: "Return JSON listing every fillable blank in this PDF." },
          { type: "input_file", filename: "document.pdf", file_data: `data:application/pdf;base64,${toBase64(new Uint8Array(await pdf.arrayBuffer()))}` },
        ] }],
        text: { format: { type: "json_schema", name: "detected_fields", strict: true, schema: {
          type: "object", additionalProperties: false, required: ["fields"],
          properties: { fields: { type: "array", items: {
            type: "object", additionalProperties: false,
            required: ["page", "type", "label", "signer_role", "x_pct", "y_pct", "w_pct", "h_pct"],
            properties: {
              page: { type: "integer" },
              type: { type: "string", enum: [...TYPES] },
              label: { type: "string" },
              signer_role: { anyOf: [{ type: "string" }, { type: "null" }] },
              x_pct: { type: "number" }, y_pct: { type: "number" }, w_pct: { type: "number" }, h_pct: { type: "number" },
            },
          } } },
        } } },
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
    const result = ResultSchema.safeParse(JSON.parse(output));
    if (!result.success) return json({ error: "The AI response was incomplete. Please try again." }, 502, correlationHeaders);
    const fields = result.data.fields.map((f) => {
      const w = clamp(f.w_pct, 0.02, 0.9), h = clamp(f.h_pct, 0.015, 0.2);
      return { ...f, w_pct: w, h_pct: h, x_pct: clamp(f.x_pct, 0, 1 - w), y_pct: clamp(f.y_pct, 0, 1 - h) };
    });
    return json({ fields }, 200, correlationHeaders);
  } catch (error) {
    console.error("detect-fields failed", error);
    return json({ error: "Field detection failed." }, 500);
  }
});

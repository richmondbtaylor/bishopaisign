import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PRICE_MAP: Record<string, string> = {
  "pro:monthly": "pro_monthly",
  "pro:annual": "pro_annual",
  "business:monthly": "business_monthly",
  "business:annual": "business_annual",
};

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId: string },
): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(options.userId)) throw new Error("Invalid userId");
  const found = await stripe.customers.search({
    query: `metadata['userId']:'${options.userId}'`,
    limit: 1,
  });
  if (found.data.length) return found.data[0].id;
  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing.data.length) {
      const c = existing.data[0];
      if (c.metadata?.userId !== options.userId) {
        await stripe.customers.update(c.id, { metadata: { ...c.metadata, userId: options.userId } });
      }
      return c.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    metadata: { userId: options.userId },
  });
  return created.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { plan, interval, environment, returnUrl } = await req.json();
    const key = `${plan}:${interval}`;
    const priceLookup = PRICE_MAP[key];
    if (!priceLookup) {
      return new Response(JSON.stringify({ error: "Invalid plan or interval" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const env: StripeEnv = environment === "live" ? "live" : "sandbox";
    const stripe = createStripeClient(env);

    const prices = await stripe.prices.list({ lookup_keys: [priceLookup] });
    if (!prices.data.length) throw new Error("Price not found");
    const price = prices.data[0];

    const customerId = await resolveOrCreateCustomer(stripe, {
      userId: user.id,
      email: user.email ?? undefined,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ui_mode: "embedded_page",
      return_url: returnUrl || "https://bishopaisign.lovable.app/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      customer: customerId,
      line_items: [{ price: price.id, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { userId: user.id, plan, billing_interval: interval },
      },
      metadata: { userId: user.id, plan, billing_interval: interval },
    });

    return new Response(JSON.stringify({ clientSecret: session.client_secret, sessionId: session.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("create-checkout-session error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

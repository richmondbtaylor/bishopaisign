import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, verifyWebhook } from "../_shared/stripe.ts";

let _supabase: ReturnType<typeof createClient> | null = null;
function db() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return _supabase;
}

function upsertPayload(sub: any, env: StripeEnv) {
  const item = sub.items?.data?.[0];
  const priceLookup = item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
  const productId = typeof item?.price?.product === "string" ? item.price.product : item?.price?.product?.id;
  const periodStart = item?.current_period_start ?? sub.current_period_start;
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  const plan = sub.metadata?.plan
    || (priceLookup?.startsWith("pro") ? "pro" : priceLookup?.startsWith("business") ? "business" : null);
  const billingInterval = sub.metadata?.billing_interval
    || (priceLookup?.endsWith("_annual") ? "annual" : "monthly");
  return {
    user_id: sub.metadata?.userId,
    stripe_subscription_id: sub.id,
    stripe_customer_id: sub.customer,
    product_id: productId,
    price_id: priceLookup,
    plan,
    billing_interval: billingInterval,
    status: sub.status,
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end || false,
    environment: env,
    updated_at: new Date().toISOString(),
  };
}

async function handle(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  const type = event.type;
  const obj: any = event.data.object;

  if (type.startsWith("customer.subscription.")) {
    if (!obj.metadata?.userId) {
      console.warn("subscription without userId metadata", obj.id);
      return;
    }
    const payload = upsertPayload(obj, env);
    if (type === "customer.subscription.deleted") {
      payload.status = "canceled";
    }
    await db().from("subscriptions").upsert(payload, { onConflict: "stripe_subscription_id" });
  } else if (type === "checkout.session.completed") {
    // Subscription webhook covers this too; nothing extra to do.
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = new URL(req.url).searchParams.get("env");
  if (raw !== "sandbox" && raw !== "live") {
    return new Response(JSON.stringify({ received: true, ignored: "invalid env" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  try {
    await handle(req, raw);
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("payments-webhook error", e);
    return new Response("Webhook error", { status: 400 });
  }
});

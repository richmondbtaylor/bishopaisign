import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RequireAuth, useAuth } from "@/hooks/useAuth";
import { useSubscription, getStripeEnvironment } from "@/hooks/useSubscription";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";
import { loadStripe, Stripe } from "@stripe/stripe-js";

const CLIENT_TOKEN = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    if (!CLIENT_TOKEN) throw new Error("Payments are not configured.");
    stripePromise = loadStripe(CLIENT_TOKEN);
  }
  return stripePromise;
}

const PLAN_LABEL: Record<string, string> = {
  pro: "Pro",
  business: "Business",
};

function CheckoutPanel({ plan, interval, onClose }: { plan: string; interval: string; onClose: () => void }) {
  const options = {
    fetchClientSecret: async () => {
      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: {
          plan,
          interval,
          environment: getStripeEnvironment(),
          returnUrl: `${window.location.origin}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        },
      });
      if (error || !data?.clientSecret) throw new Error(error?.message || "Checkout failed");
      return data.clientSecret as string;
    },
  };
  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div>
          <p className="text-sm text-muted-foreground">Subscribing to</p>
          <p className="font-heading font-semibold text-foreground">
            {PLAN_LABEL[plan] || plan} · {interval === "annual" ? "Annual" : "Monthly"}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
      <div id="checkout" className="min-h-[600px]">
        <EmbeddedCheckoutProvider stripe={getStripe()} options={options}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </div>
  );
}

function BillingInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { sub, plan, isTrialing, trialDaysLeft } = useSubscription();
  const [selection, setSelection] = useState<{ plan: string; interval: string } | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const p = params.get("plan");
    const i = params.get("interval");
    if (p && i && (p === "pro" || p === "business")) {
      setSelection({ plan: p, interval: i === "annual" ? "annual" : "monthly" });
    }
  }, [location.search]);

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-portal-session", {
        body: { environment: getStripeEnvironment(), returnUrl: `${window.location.origin}/billing` },
      });
      if (error || !data?.url) throw new Error(error?.message || "Failed to open billing portal");
      window.open(data.url, "_blank");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <button
          onClick={() => navigate("/dashboard")}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </button>
        <h1 className="font-heading text-3xl font-bold text-foreground mb-2">Billing</h1>
        <p className="text-muted-foreground mb-8">Manage your BishopAI Sign subscription.</p>

        <div className="border border-border rounded-xl p-6 bg-card mb-8">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Current plan</p>
              <p className="font-heading text-2xl font-bold text-foreground capitalize">{plan}</p>
              {sub && (
                <p className="text-sm text-muted-foreground mt-1">
                  Status: <span className="font-medium capitalize">{sub.status.replace("_", " ")}</span>
                  {isTrialing && ` · ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left in trial`}
                  {sub.current_period_end && ` · renews ${new Date(sub.current_period_end).toLocaleDateString()}`}
                </p>
              )}
            </div>
            {sub && (
              <Button onClick={openPortal} disabled={portalLoading}>
                {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-2" />}
                Manage billing
              </Button>
            )}
          </div>
        </div>

        {selection ? (
          <CheckoutPanel
            plan={selection.plan}
            interval={selection.interval}
            onClose={() => setSelection(null)}
          />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {(["pro", "business"] as const).map((p) => (
              <div key={p} className="border border-border rounded-xl p-6 bg-card">
                <h3 className="font-heading text-lg font-bold text-foreground">{PLAN_LABEL[p]}</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {p === "pro"
                    ? "Unlimited documents, templates, and reminders."
                    : "Bulk send, teams, shared templates."}
                </p>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => setSelection({ plan: p, interval: "monthly" })}>
                    {p === "pro" ? "$15/mo" : "$22/mo"}
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => setSelection({ plan: p, interval: "annual" })}>
                    {p === "pro" ? "$8/mo annual" : "$13/mo annual"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Billing() {
  return (
    <RequireAuth>
      <BillingInner />
    </RequireAuth>
  );
}

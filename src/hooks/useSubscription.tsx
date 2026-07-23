import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface Subscription {
  id: string;
  plan: string | null;
  billing_interval: string | null;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  stripe_customer_id: string;
}

const STRIPE_ENV: "sandbox" | "live" = (() => {
  const t = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;
  if (t?.startsWith("pk_live_")) return "live";
  return "sandbox";
})();

export function getStripeEnvironment() {
  return STRIPE_ENV;
}

export function useSubscription() {
  const { user } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = async () => {
    if (!user) {
      setSub(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("subscriptions")
      .select("id, plan, billing_interval, status, trial_ends_at, current_period_end, cancel_at_period_end, stripe_customer_id")
      .eq("user_id", user.id)
      .eq("environment", STRIPE_ENV)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSub((data as Subscription | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    refetch();
    if (!user) return;
    const channel = supabase
      .channel(`subs-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${user.id}` },
        () => refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const isActive = sub && ["active", "trialing", "past_due"].includes(sub.status);
  const isTrialing = sub?.status === "trialing";
  const trialDaysLeft = sub?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 864e5))
    : 0;
  const plan = sub?.plan ?? "free";

  return { sub, loading, refetch, isActive, isTrialing, trialDaysLeft, plan };
}

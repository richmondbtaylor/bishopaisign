import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useState } from "react";

type Interval = "monthly" | "annual";

const tiers = [
  {
    name: "Free",
    price: { monthly: "$0", annual: "$0" },
    period: "/month",
    description: "Try it out with core signing features.",
    documents: "5 documents/month, 1 user",
    features: [
      "All field types",
      "Sequential and parallel signing",
      "Email verification",
      "Audit trail",
      "Mobile signing",
    ],
    cta: "Start free",
    highlighted: false,
    plan: "free" as const,
  },
  {
    name: "Pro",
    price: { monthly: "$15", annual: "$8" },
    period: "/month",
    description: "For professionals who send contracts regularly.",
    documents: "Unlimited documents",
    features: [
      "Everything in Free",
      "Unlimited templates",
      "Automatic reminders",
      "Custom branding",
      "API access",
      "Webhook notifications",
      "Priority support",
    ],
    cta: "Start 14-day free trial",
    highlighted: true,
    plan: "pro" as const,
  },
  {
    name: "Business",
    price: { monthly: "$22", annual: "$13" },
    period: "/user/month",
    description: "For teams that need shared workflows and bulk send.",
    documents: "Unlimited documents",
    features: [
      "Everything in Pro",
      "Bulk send",
      "Up to 10 team members",
      "Shared templates",
      "Admin controls",
      "Team document visibility",
      "Signer attachments",
      "Higher API rate limits",
    ],
    cta: "Start 14-day free trial",
    highlighted: false,
    plan: "business" as const,
  },
];

const PricingSection = () => {
  const [interval, setInterval] = useState<Interval>("monthly");

  return (
    <section id="pricing" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-sm font-semibold tracking-widest uppercase text-primary mb-3">
            Pricing
          </p>
          <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-4">
            Simple plans. Real savings.
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            14-day free trial on paid plans. No credit card required to start.
          </p>
        </div>

        <div className="flex justify-center mb-12">
          <div
            role="tablist"
            aria-label="Billing interval"
            className="inline-flex items-center bg-muted rounded-full p-1 border border-border"
          >
            {(["monthly", "annual"] as const).map((opt) => (
              <button
                key={opt}
                role="tab"
                aria-selected={interval === opt}
                onClick={() => setInterval(opt)}
                className={`px-5 py-2 text-sm font-medium rounded-full transition-colors ${
                  interval === opt
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt === "monthly" ? "Monthly" : "Annual"}
                {opt === "annual" && (
                  <span className="ml-2 text-xs font-semibold text-primary">Save up to 47%</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 items-start">
          {tiers.map((tier) => {
            const priceHref =
              tier.plan === "free"
                ? "/auth"
                : `/auth?next=checkout&plan=${tier.plan}&interval=${interval}`;
            return (
              <div
                key={tier.name}
                className={`relative rounded-2xl p-8 transition-all duration-300 ${
                  tier.highlighted
                    ? "bg-card border-2 border-primary shadow-glow scale-[1.02]"
                    : "bg-card border border-border hover:shadow-elevated"
                }`}
              >
                {tier.highlighted && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-accent-gradient text-primary-foreground text-xs font-semibold px-4 py-1 rounded-full">
                    Most popular
                  </span>
                )}
                <h3 className="font-heading text-xl font-bold text-foreground">{tier.name}</h3>
                <p className="text-muted-foreground text-sm mt-1 mb-4">{tier.description}</p>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="font-heading text-4xl font-bold text-foreground">
                    {tier.price[interval]}
                  </span>
                  <span className="text-muted-foreground">{tier.period}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {tier.plan === "free"
                    ? "Free forever"
                    : interval === "annual"
                    ? "billed annually"
                    : "billed monthly"}
                </p>
                <p className="text-sm text-primary font-medium mb-6">{tier.documents}</p>
                <Link to={priceHref}>
                  <Button
                    variant={tier.highlighted ? "default" : "outline"}
                    className="w-full mb-8"
                    size="lg"
                  >
                    {tier.cta}
                  </Button>
                </Link>
                <ul className="space-y-3">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm">
                      <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <span className="text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <p className="text-center text-sm text-muted-foreground mt-10">
          14-day free trial on paid plans, no credit card required to start.
        </p>
      </div>
    </section>
  );
};

export default PricingSection;

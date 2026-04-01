import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const tiers = [
  {
    name: "Free",
    price: "$0",
    period: "/month",
    description: "Try it out with core signing features.",
    documents: "5 documents/month",
    features: [
      "3 signature methods",
      "Sequential & parallel signing",
      "Email verification",
      "Audit trail",
      "Mobile-friendly signing",
    ],
    cta: "Start Free",
    highlighted: false,
  },
  {
    name: "Pro",
    price: "$12",
    period: "/month",
    description: "For professionals who send contracts regularly.",
    documents: "50 documents/month",
    features: [
      "Everything in Free",
      "Unlimited templates",
      "SMS verification",
      "Custom branding (logo & color)",
      "API access",
      "Webhook notifications",
      "Priority support",
    ],
    cta: "Start Free Trial",
    highlighted: true,
  },
  {
    name: "Team",
    price: "$39",
    period: "/month",
    description: "For teams that need shared workflows.",
    documents: "200 documents/month",
    features: [
      "Everything in Pro",
      "Up to 10 team members",
      "Shared templates",
      "Admin controls",
      "Team document visibility",
      "Higher API rate limits",
    ],
    cta: "Start Free Trial",
    highlighted: false,
  },
];

const PricingSection = () => {
  return (
    <section id="pricing" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold tracking-widest uppercase text-primary mb-3">
            Pricing
          </p>
          <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-4">
            Half the price. Twice the speed.
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            No hidden fees. No per-user charges on individual plans. Cancel anytime.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8 items-start">
          {tiers.map((tier) => (
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
                  Most Popular
                </span>
              )}
              <h3 className="font-heading text-xl font-bold text-foreground">{tier.name}</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-4">{tier.description}</p>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="font-heading text-4xl font-bold text-foreground">{tier.price}</span>
                <span className="text-muted-foreground">{tier.period}</span>
              </div>
              <p className="text-sm text-primary font-medium mb-6">{tier.documents}</p>
              <Link to="/auth">
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
          ))}
        </div>
      </div>
    </section>
  );
};

export default PricingSection;

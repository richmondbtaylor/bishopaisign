import { FileSignature, Zap, Shield, Users, LayoutTemplate, Globe } from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "60-Second Sending",
    description: "Upload, place fields, and send for signature in under a minute. No bloat, no friction.",
  },
  {
    icon: FileSignature,
    title: "Three Signing Methods",
    description: "Type, draw, or upload a signature. Signers choose what works best - no account needed.",
  },
  {
    icon: Shield,
    title: "Legally Binding",
    description: "ESIGN Act & UETA compliant with tamper-evident audit trails and full identity verification.",
  },
  {
    icon: Users,
    title: "Multi-Signer Workflows",
    description: "Sequential or parallel signing. Define the order, and the system handles the rest automatically.",
  },
  {
    icon: LayoutTemplate,
    title: "Reusable Templates",
    description: "Place fields once, send repeatedly. Save hours on contracts you send every week.",
  },
  {
    icon: Globe,
    title: "Developer API",
    description: "RESTful API with webhooks. Embed signing into your apps with full programmatic control.",
  },
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-24 px-6 bg-subtle-gradient">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold tracking-widest uppercase text-primary mb-3">
            Features
          </p>
          <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-4">
            Everything you need to close deals faster
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Built for speed and simplicity. No feature bloat, no unnecessary clicks.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group p-6 rounded-xl bg-card border border-border hover:shadow-elevated transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <feature.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-heading text-lg font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;

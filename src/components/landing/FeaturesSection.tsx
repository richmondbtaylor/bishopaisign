import {
  FileSignature,
  Zap,
  Shield,
  Users,
  LayoutTemplate,
  Globe,
  MousePointerClick,
  Send,
  BellRing,
  Award,
  Smartphone,
} from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "60-Second Sending",
    description: "Upload, place fields, and send for signature in under a minute. No bloat, no friction.",
  },
  {
    icon: MousePointerClick,
    title: "Drag-and-drop document prep",
    description: "Upload any PDF and drop signature, initials, date, text, and checkbox fields exactly where you need them.",
  },
  {
    icon: LayoutTemplate,
    title: "Reusable templates",
    description: "Save field placement and signing order once, then send in seconds every time after.",
  },
  {
    icon: Users,
    title: "Signing order and routing",
    description: "Sequential or parallel routing with defined roles for every recipient.",
  },
  {
    icon: Send,
    title: "Bulk send",
    description: "Import a recipient list and each person gets their own unique copy to sign and track.",
  },
  {
    icon: BellRing,
    title: "Automatic reminders",
    description: "Slow signers get nudged on a schedule so you never chase a signature again.",
  },
  {
    icon: Award,
    title: "Certificate of completion",
    description: "Every finished document includes a tamper-proof certificate showing who signed, when, and from where.",
  },
  {
    icon: Shield,
    title: "Full audit trail",
    description: "Timestamped record of every action on every envelope, exportable as PDF.",
  },
  {
    icon: Smartphone,
    title: "Sign from anywhere",
    description: "Mobile-friendly signing with no signer account required.",
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

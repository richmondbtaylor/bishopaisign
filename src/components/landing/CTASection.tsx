import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const CTASection = () => {
  return (
    <section className="py-24 px-6 relative overflow-hidden">
      <div className="relative max-w-4xl mx-auto rounded-[2.5rem] bg-foreground text-background p-14 md:p-20 text-center overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.08] pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, hsl(var(--background)) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="relative">
          <h2 className="font-heading text-3xl md:text-5xl font-semibold tracking-tight mb-4">
            Ready to close deals faster?
          </h2>
          <p className="text-background/60 text-lg mb-10 max-w-xl mx-auto">
            Join teams sending contracts in under a minute. Set up in two.
          </p>
          <Link to="/auth">
            <Button size="lg" className="gap-2 text-base px-8 h-12 rounded-full bg-accent text-accent-foreground hover:bg-accent/90">
              Get Started Free <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default CTASection;

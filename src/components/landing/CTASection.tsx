import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

const CTASection = () => {
  return (
    <section className="py-24 px-6 bg-hero relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-primary/15 rounded-full blur-[100px]" />
      <div className="relative max-w-3xl mx-auto text-center">
        <h2 className="font-heading text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
          Ready to ditch the overpriced alternative?
        </h2>
        <p className="text-primary-foreground/60 text-lg mb-8 max-w-xl mx-auto">
          Join thousands of small businesses sending contracts faster and cheaper. Set up in 2 minutes.
        </p>
        <Button variant="hero" size="lg" className="gap-2 text-base px-10 h-12">
          Get Started Free <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </section>
  );
};

export default CTASection;

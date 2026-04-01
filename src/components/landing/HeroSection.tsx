import { Button } from "@/components/ui/button";
import { ArrowRight, Play } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const HeroSection = () => {
  return (
    <section className="relative bg-hero pt-32 pb-24 px-6 overflow-hidden">
      {/* Subtle grid pattern */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
      }} />
      
      {/* Glow effect */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary/10 rounded-full blur-[120px]" />

      <div className="relative max-w-4xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary-foreground/10 bg-primary-foreground/5 text-primary-foreground/70 text-sm mb-8">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Now in public beta
          </span>
        </motion.div>

        <motion.h1
          className="font-heading text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-primary-foreground leading-[1.1] mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          E-signatures that{" "}
          <span className="text-gradient">close deals</span>,{" "}
          not budgets
        </motion.h1>

        <motion.p
          className="text-lg md:text-xl text-primary-foreground/60 max-w-2xl mx-auto mb-10 leading-relaxed"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          Send documents for signature in under 60 seconds. Signers complete on any device — no account required. Half the price of DocuSign.
        </motion.p>

        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Link to="/auth">
            <Button variant="hero" size="lg" className="gap-2 text-base px-8 h-12">
              Start Sending for Free <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Button variant="hero-outline" size="lg" className="gap-2 text-base px-8 h-12" onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>
            <Play className="w-4 h-4" /> Watch Demo
          </Button>
        </motion.div>

        <motion.p
          className="mt-6 text-sm text-primary-foreground/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          Free plan includes 5 documents/month · No credit card required
        </motion.p>
      </div>
    </section>
  );
};

export default HeroSection;

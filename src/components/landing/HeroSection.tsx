import { Button } from "@/components/ui/button";
import { ArrowRight, Play, Plus, Globe, PenLine, Code2, FileSignature } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

const HeroSection = () => {
  return (
    <section className="relative pt-32 pb-24 px-6 overflow-hidden bg-background">
      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 80%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
        <div>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-xs font-semibold tracking-[0.2em] uppercase text-foreground/70 mb-6 flex items-center gap-2"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            E-Signature Platform
          </motion.p>

          <motion.h1
            className="font-heading text-5xl md:text-6xl lg:text-7xl font-semibold text-foreground leading-[1.02] tracking-tight mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            Send.{" "}
            <span className="relative inline-block">
              <span className="relative z-10">Sign.</span>
              <span className="absolute inset-x-[-6px] bottom-1 h-[45%] bg-accent/60 -z-0 rounded-sm" />
            </span>{" "}
            Done.
          </motion.h1>

          <motion.p
            className="text-lg md:text-xl text-foreground/60 max-w-xl mb-10 leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            E-signatures for teams that move fast. Upload, place fields, and send in under 60 seconds - no bloat, no per-seat surprises.
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row items-start sm:items-center gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Link to="/auth">
              <Button size="lg" className="gap-2 text-base px-7 h-12 rounded-full bg-accent text-accent-foreground hover:bg-accent/90 shadow-md">
                Start Sending Free <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="gap-2 text-base px-7 h-12 rounded-full border-foreground/20 hover:bg-foreground/5"
              onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
            >
              <Play className="w-4 h-4" /> See how it works
            </Button>
          </motion.div>

          <motion.p
            className="mt-6 text-sm text-foreground/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            Free plan · No credit card · Cancel anytime
          </motion.p>
        </div>

        {/* Orchestrator-style visual */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative"
        >
          <div className="relative aspect-square max-w-[520px] mx-auto rounded-[2.5rem] bg-card border border-border/70 shadow-lg p-8">
            <div
              className="absolute inset-0 rounded-[2.5rem] opacity-[0.4] pointer-events-none"
              style={{
                backgroundImage: "radial-gradient(circle, hsl(var(--foreground) / 0.15) 1px, transparent 1px)",
                backgroundSize: "16px 16px",
              }}
            />

            {/* Corner nodes */}
            {[
              { pos: "top-6 left-6", icon: Plus, label: "Upload" },
              { pos: "top-6 right-6", icon: Globe, label: "Send" },
              { pos: "bottom-6 left-6", icon: PenLine, label: "Sign" },
              { pos: "bottom-6 right-6", icon: Code2, label: "API" },
            ].map((n) => (
              <div key={n.label} className={`absolute ${n.pos} z-10`}>
                <div className="w-20 h-20 rounded-2xl bg-background border border-border shadow-sm flex flex-col items-center justify-center gap-1">
                  <n.icon className="w-5 h-5 text-foreground" strokeWidth={1.5} />
                </div>
                <p className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-foreground/50 text-center">
                  {n.label}
                </p>
              </div>
            ))}

            {/* Connecting lines */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1="18" y1="18" x2="50" y2="50" stroke="hsl(var(--accent))" strokeWidth="0.3" strokeDasharray="1 1" />
              <line x1="82" y1="18" x2="50" y2="50" stroke="hsl(var(--accent))" strokeWidth="0.3" strokeDasharray="1 1" />
              <line x1="18" y1="82" x2="50" y2="50" stroke="hsl(var(--accent))" strokeWidth="0.3" strokeDasharray="1 1" />
              <line x1="82" y1="82" x2="50" y2="50" stroke="hsl(var(--accent))" strokeWidth="0.3" strokeDasharray="1 1" />
            </svg>

            {/* Center device */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-36 h-36 rounded-3xl bg-foreground text-background flex flex-col items-center justify-center shadow-2xl">
                <FileSignature className="w-8 h-8" strokeWidth={1.5} />
                <p className="font-heading text-sm font-semibold mt-2">BishopAI</p>
                <p className="text-[10px] opacity-70">Sign</p>
                <div className="mt-2 w-8 h-0.5 bg-accent rounded-full" />
              </div>
            </div>
          </div>
          <p className="text-center mt-4 text-[10px] font-semibold tracking-[0.3em] uppercase text-foreground/50">
            Signing Orchestrator v2.0
          </p>
        </motion.div>
      </div>
    </section>
  );
};

export default HeroSection;

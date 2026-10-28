import { Button } from "@/components/ui/button";
import { ArrowRight, Play, Plus, Globe, PenLine, Code2, FileSignature } from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import glowSrc from "@/assets/bishopai-glow.png";

const Highlight = ({ children }: { children: React.ReactNode }) => (
  <span className="relative inline-block">
    <span className="relative z-10">{children}</span>
    <span className="absolute inset-x-[-4px] inset-y-[6%] bg-accent/80 -z-0 rounded-md" />
  </span>
);

const HeroSection = () => {
  return (
    <section className="relative pt-32 pb-24 px-6 overflow-hidden bg-background">
      {/* Dotted grid pattern with soft lavender glow */}
      <div
        className="absolute inset-0 opacity-60 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, hsl(var(--foreground) / 0.10) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse 85% 65% at 50% 35%, black 25%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse 85% 65% at 50% 35%, black 25%, transparent 80%)",
        }}
      />
      <div
        className="absolute -top-32 -left-24 w-[32rem] h-[32rem] rounded-full pointer-events-none blur-3xl opacity-40"
        style={{ background: "radial-gradient(circle, hsl(var(--accent) / 0.55) 0%, transparent 70%)" }}
      />
      <div
        className="absolute top-40 -right-32 w-[28rem] h-[28rem] rounded-full pointer-events-none blur-3xl opacity-30"
        style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.18) 0%, transparent 70%)" }}
      />

      <div className="relative max-w-6xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
        <div>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-xs font-semibold tracking-[0.2em] uppercase text-foreground/70 mb-6 flex items-center gap-2"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            E-Signature Platform
          </motion.p>

          <motion.h1
            className="font-heading text-5xl md:text-6xl lg:text-7xl font-semibold text-foreground leading-[1.02] tracking-tight mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            Send, sign, and{" "}
            <Highlight>close.</Highlight>{" "}
            In minutes, not days.
          </motion.h1>

          <motion.p
            className="text-lg md:text-xl text-foreground/60 max-w-xl mb-10 leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            Legally binding eSignatures with everything the big platforms offer,{" "}
            <span className="text-foreground font-medium">
              <Highlight>at a third of the price.</Highlight>
            </span>
          </motion.p>

          <motion.div
            className="flex flex-col sm:flex-row items-start sm:items-center gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Link to="/auth">
              <Button size="lg" className="gap-2 text-base px-7 h-12 rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-md">
                Start free <ArrowRight className="w-4 h-4" />
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
            256-bit encryption. Court-admissible audit trails. Cancel anytime.
          </motion.p>

        </div>

        {/* Dark orchestrator visual with violet glow */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative"
        >
          <div className="relative aspect-square max-w-[520px] mx-auto rounded-[2.5rem] bg-foreground overflow-hidden shadow-2xl">
            {/* Violet glow at center */}
            <img
              src={glowSrc}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover opacity-90 pointer-events-none select-none"
            />
            {/* Subtle dot texture over the dark card */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: "radial-gradient(circle, hsl(0 0% 100% / 0.10) 1px, transparent 1px)",
                backgroundSize: "22px 22px",
                opacity: 0.35,
              }}
            />
            {/* Vignette to keep edges deep and dark */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse 70% 70% at 50% 50%, transparent 40%, hsl(var(--foreground) / 0.92) 100%)",
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
                <div className="w-20 h-20 rounded-2xl bg-foreground/70 backdrop-blur-sm border border-white/15 shadow-lg flex flex-col items-center justify-center gap-1">
                  <n.icon className="w-5 h-5 text-background" strokeWidth={1.5} />
                </div>
                <p className="mt-2 text-[10px] font-semibold tracking-widest uppercase text-background/50 text-center">
                  {n.label}
                </p>
              </div>
            ))}

            {/* Connecting lines */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1="18" y1="18" x2="50" y2="50" stroke="hsl(var(--secondary))" strokeWidth="0.4" strokeDasharray="1 1" />
              <line x1="82" y1="18" x2="50" y2="50" stroke="hsl(var(--secondary))" strokeWidth="0.4" strokeDasharray="1 1" />
              <line x1="18" y1="82" x2="50" y2="50" stroke="hsl(var(--secondary))" strokeWidth="0.4" strokeDasharray="1 1" />
              <line x1="82" y1="82" x2="50" y2="50" stroke="hsl(var(--secondary))" strokeWidth="0.4" strokeDasharray="1 1" />
            </svg>

            {/* Center device */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative">
                <div
                  className="absolute -inset-10 rounded-full pointer-events-none blur-2xl"
                  style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.55) 0%, transparent 70%)" }}
                />
                <div className="relative w-36 h-36 rounded-3xl bg-foreground border border-white/20 flex flex-col items-center justify-center shadow-2xl">
                  <FileSignature className="w-8 h-8 text-background" strokeWidth={1.5} />
                  <p className="font-heading text-sm font-semibold mt-2 text-background">BishopAI</p>
                  <p className="text-[10px] opacity-70 text-background">Sign</p>
                  <div className="mt-2 w-8 h-0.5 bg-accent rounded-full" />
                </div>
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

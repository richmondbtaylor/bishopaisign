import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import logoAsset from "@/assets/bishopai-logo.png.asset.json";

const Navbar = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/60">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <img src={logoAsset.url} alt="BishopAI Sign" className="w-9 h-9 rounded-full object-cover" />
          <span className="font-heading text-lg font-semibold tracking-tight text-foreground">BishopAI Sign</span>
        </Link>
        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm text-foreground/70 hover:text-foreground transition-colors">Features</a>
          <a href="#pricing" className="text-sm text-foreground/70 hover:text-foreground transition-colors">Pricing</a>
          <a href="#api" className="text-sm text-foreground/70 hover:text-foreground transition-colors">API</a>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/auth">
            <Button variant="ghost" size="sm" className="text-foreground/80 hover:text-foreground hover:bg-foreground/5">
              Sign In
            </Button>
          </Link>
          <Link to="/auth">
            <Button size="sm" className="gap-1.5 rounded-full bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm">
              Get Started <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

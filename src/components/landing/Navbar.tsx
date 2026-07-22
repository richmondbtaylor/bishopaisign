import { Button } from "@/components/ui/button";
import { ArrowRight, FileSignature } from "lucide-react";
import { Link } from "react-router-dom";

const Navbar = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-foreground/95 backdrop-blur-md border-b border-primary-foreground/10">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-gradient flex items-center justify-center">
            <FileSignature className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-heading text-lg font-bold text-primary-foreground">BishopAI Sign</span>
        </Link>
        <div className="hidden md:flex items-center gap-8">
          <a href="#features" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">Features</a>
          <a href="#pricing" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">Pricing</a>
          <a href="#api" className="text-sm text-primary-foreground/70 hover:text-primary-foreground transition-colors">API</a>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/auth">
            <Button variant="ghost" size="sm" className="text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10">
              Sign In
            </Button>
          </Link>
          <Link to="/auth">
            <Button variant="hero" size="sm" className="gap-1.5">
              Get Started <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;

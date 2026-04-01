import { FileSignature } from "lucide-react";

const Footer = () => {
  return (
    <footer className="border-t border-border py-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div>
            <a href="/" className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-md bg-accent-gradient flex items-center justify-center">
                <FileSignature className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
              <span className="font-heading text-base font-bold text-foreground">SignVault</span>
            </a>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The faster, affordable e-signature platform for small businesses.
            </p>
          </div>
          <div>
            <h4 className="font-heading text-sm font-semibold text-foreground mb-3">Product</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
              <li><a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a></li>
              <li><a href="#api" className="hover:text-foreground transition-colors">API</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Templates</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-heading text-sm font-semibold text-foreground mb-3">Company</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#" className="hover:text-foreground transition-colors">About</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Blog</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Careers</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Contact</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-heading text-sm font-semibold text-foreground mb-3">Legal</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li><a href="#" className="hover:text-foreground transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Terms of Service</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Security</a></li>
              <li><a href="#" className="hover:text-foreground transition-colors">Compliance</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">© 2026 SignVault. All rights reserved.</p>
          <p className="text-xs text-muted-foreground">ESIGN Act & UETA Compliant</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

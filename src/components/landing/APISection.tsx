import { Code, Webhook, Key } from "lucide-react";

const APISection = () => {
  return (
    <section id="api" className="py-24 px-6 bg-subtle-gradient">
      <div className="max-w-6xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-sm font-semibold tracking-widest uppercase text-primary mb-3">
              Developer API
            </p>
            <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-4">
              Embed signing into your product
            </h2>
            <p className="text-muted-foreground text-lg mb-8 leading-relaxed">
              RESTful API with webhooks, SDKs in popular languages, and full programmatic control over the signing workflow.
            </p>
            <div className="space-y-4">
              {[
                { icon: Code, title: "Full Workflow API", desc: "Upload, define fields, send, and retrieve — all via API." },
                { icon: Webhook, title: "Real-time Webhooks", desc: "Get notified when documents are viewed, signed, or completed." },
                { icon: Key, title: "Secure API Keys", desc: "Rate-limited per plan tier with granular access control." },
              ].map((item) => (
                <div key={item.title} className="flex gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <item.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-heading text-sm font-semibold text-foreground">{item.title}</h4>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-foreground rounded-xl p-6 font-mono text-sm overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-3 h-3 rounded-full bg-destructive/60" />
              <span className="w-3 h-3 rounded-full bg-amber-400/60" />
              <span className="w-3 h-3 rounded-full bg-primary/60" />
            </div>
            <pre className="text-primary-foreground/80 overflow-x-auto"><code>{`curl -X POST \\
  https://api.signvault.io/v1/documents \\
  -H "Authorization: Bearer sk_live_..." \\
  -F "file=@contract.pdf" \\
  -F 'signers=[{
    "email": "jane@acme.com",
    "name": "Jane Smith",
    "order": 1
  }]'

{
  "id": "doc_8xKj3mN",
  "status": "sent",
  "signing_url": "https://sign.signvault.io/s/..."
}`}</code></pre>
          </div>
        </div>
      </div>
    </section>
  );
};

export default APISection;

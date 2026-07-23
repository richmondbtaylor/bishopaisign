const rows = [
  {
    label: "Price",
    us: "A third of the cost of legacy platforms",
    them: "Premium pricing with per-seat fees",
  },
  {
    label: "Envelope limits",
    us: "Generous limits on every plan",
    them: "Often capped at 100 envelopes per year",
  },
  {
    label: "Setup time",
    us: "Minutes. Self-serve from day one",
    them: "Sales calls and onboarding cycles",
  },
];

const ComparisonSection = () => {
  return (
    <section id="compare" className="py-24 px-6 bg-background">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-sm font-semibold tracking-widest uppercase text-primary mb-3">
            Comparison
          </p>
          <h2 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-4">
            BishopAI Sign vs legacy eSignature platforms
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
            Same legal weight. Better price. Faster to ship.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="grid grid-cols-3 bg-muted/40 border-b border-border">
            <div className="p-4 md:p-5 text-xs md:text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Category
            </div>
            <div className="p-4 md:p-5 text-xs md:text-sm font-semibold uppercase tracking-wider text-primary">
              BishopAI Sign
            </div>
            <div className="p-4 md:p-5 text-xs md:text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Legacy platforms
            </div>
          </div>
          {rows.map((r, i) => (
            <div
              key={r.label}
              className={`grid grid-cols-3 ${i !== rows.length - 1 ? "border-b border-border" : ""}`}
            >
              <div className="p-4 md:p-5 font-medium text-foreground">{r.label}</div>
              <div className="p-4 md:p-5 text-foreground">{r.us}</div>
              <div className="p-4 md:p-5 text-muted-foreground">{r.them}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ComparisonSection;

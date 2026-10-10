import { Sparkles } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export type SummaryItem = { title: string; explanation: string; page: number | null };
export type DocumentSummary = {
  overview: string;
  clauses: SummaryItem[];
  deadlines: SummaryItem[];
  obligations: SummaryItem[];
};

const SummaryGroup = ({ title, items }: { title: string; items: SummaryItem[] }) => (
  <AccordionItem value={title.toLowerCase()}>
    <AccordionTrigger className="py-3 text-sm">{title} ({items.length})</AccordionTrigger>
    <AccordionContent>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">None identified.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={`${item.title}-${index}`} className="border-l-2 border-primary pl-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                {item.page && <span className="shrink-0 text-xs text-muted-foreground">Page {item.page}</span>}
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.explanation}</p>
            </div>
          ))}
        </div>
      )}
    </AccordionContent>
  </AccordionItem>
);

const DocumentAiSummary = ({ summary }: { summary: DocumentSummary }) => (
  <section className="border border-border rounded-lg bg-card p-4 sm:p-5" aria-label="AI document summary">
    <div className="flex items-center gap-2">
      <Sparkles className="h-4 w-4 text-primary" />
      <h2 className="font-heading text-base font-semibold text-foreground">AI document summary</h2>
    </div>
    <p className="mt-3 text-sm leading-6 text-foreground">{summary.overview}</p>
    <Accordion type="multiple" className="mt-2">
      <SummaryGroup title="Key clauses" items={summary.clauses} />
      <SummaryGroup title="Deadlines" items={summary.deadlines} />
      <SummaryGroup title="Obligations" items={summary.obligations} />
    </Accordion>
    <p className="mt-3 text-xs text-muted-foreground">AI-generated summary. Not legal advice. Review the original document before acting.</p>
  </section>
);

export default DocumentAiSummary;
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Mail, CheckCircle2, XCircle, Clock, AlertTriangle, Ban } from "lucide-react";
import { format } from "date-fns";

type EmailEvent = {
  id: string;
  message_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  metadata: any;
  created_at: string;
};

const statusMeta: Record<string, { label: string; className: string; Icon: any }> = {
  pending:     { label: "Queued",    className: "bg-muted text-muted-foreground",              Icon: Clock },
  sent:        { label: "Sent",      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", Icon: CheckCircle2 },
  failed:      { label: "Failed",    className: "bg-destructive/10 text-destructive",          Icon: XCircle },
  dlq:         { label: "Failed",    className: "bg-destructive/10 text-destructive",          Icon: XCircle },
  bounced:     { label: "Bounced",   className: "bg-orange-500/10 text-orange-700 dark:text-orange-400", Icon: AlertTriangle },
  complained:  { label: "Complaint", className: "bg-orange-500/10 text-orange-700 dark:text-orange-400", Icon: AlertTriangle },
  suppressed:  { label: "Suppressed",className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",  Icon: Ban },
  rate_limited:{ label: "Retrying",  className: "bg-muted text-muted-foreground",              Icon: Clock },
};

export function EmailStatusBadge({ status }: { status: string }) {
  const m = statusMeta[status] || { label: status, className: "bg-muted text-muted-foreground", Icon: Mail };
  const Icon = m.Icon;
  return (
    <Badge variant="outline" className={`gap-1 border-0 ${m.className}`}>
      <Icon className="w-3 h-3" /> {m.label}
    </Badge>
  );
}

// Dedupe to latest row per message_id
function dedupe(rows: EmailEvent[]): EmailEvent[] {
  const map = new Map<string, EmailEvent>();
  for (const r of rows) {
    const key = r.message_id || r.id;
    const existing = map.get(key);
    if (!existing || new Date(r.created_at) > new Date(existing.created_at)) map.set(key, r);
  }
  return Array.from(map.values()).sort((a,b) => +new Date(b.created_at) - +new Date(a.created_at));
}

export default function EmailTimeline({ documentId }: { documentId: string }) {
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("email_send_log")
        .select("*")
        .eq("document_id", documentId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (mounted) {
        setEvents(dedupe((data as EmailEvent[]) || []));
        setLoading(false);
      }
    })();

    const channel = supabase
      .channel(`email-log-${documentId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "email_send_log", filter: `document_id=eq.${documentId}` },
        () => {
          supabase.from("email_send_log").select("*").eq("document_id", documentId)
            .order("created_at", { ascending: false }).limit(200)
            .then(({ data }) => setEvents(dedupe((data as EmailEvent[]) || [])));
        })
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [documentId]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading email activity…</p>;
  if (!events.length) return <p className="text-sm text-muted-foreground">No emails sent yet.</p>;

  return (
    <div className="space-y-2">
      {events.map((e) => (
        <div key={e.id} className="border border-border rounded-lg p-3 bg-card">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {e.template_name.replace(/-/g, " ")}
              </p>
              <p className="text-xs text-muted-foreground truncate">{e.recipient_email}</p>
            </div>
            <EmailStatusBadge status={e.status} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {format(new Date(e.created_at), "MMM d, yyyy 'at' h:mm a")}
          </p>
          {e.error_message && (
            <p className="text-xs text-destructive mt-2 break-words">
              <span className="font-medium">Provider response: </span>{e.error_message}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

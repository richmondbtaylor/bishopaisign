import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmailStatusBadge } from "@/components/EmailTimeline";
import { ArrowLeft, Mail, CheckCircle2, XCircle, Ban } from "lucide-react";
import { format, subDays } from "date-fns";

type Row = {
  id: string; message_id: string | null; template_name: string;
  recipient_email: string; status: string; error_message: string | null;
  document_id: string | null; created_at: string;
};

const PRESETS = [
  { label: "Last 24 hours", days: 1 },
  { label: "Last 7 days",   days: 7 },
  { label: "Last 30 days",  days: 30 },
];

function dedupe(rows: Row[]): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = r.message_id || r.id;
    const e = m.get(k);
    if (!e || new Date(r.created_at) > new Date(e.created_at)) m.set(k, r);
  }
  return [...m.values()].sort((a,b) => +new Date(b.created_at) - +new Date(a.created_at));
}

export default function AdminEmails() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const [days, setDays] = useState<number>(7);
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [templateFilter, setTemplateFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [user]);

  useEffect(() => {
    if (isAdmin !== true) return;
    (async () => {
      setLoading(true);
      const start = customStart ? new Date(customStart) : subDays(new Date(), days);
      const end = customEnd ? new Date(customEnd) : new Date();
      const { data } = await supabase
        .from("email_send_log")
        .select("*")
        .gte("created_at", start.toISOString())
        .lte("created_at", end.toISOString())
        .order("created_at", { ascending: false })
        .limit(2000);
      setRows(dedupe((data as Row[]) || []));
      setLoading(false);
      setPage(0);
    })();
  }, [isAdmin, days, customStart, customEnd]);

  const templates = useMemo(
    () => Array.from(new Set(rows.map(r => r.template_name))).sort(),
    [rows]
  );

  const filtered = useMemo(() => rows.filter(r =>
    (templateFilter === "all" || r.template_name === templateFilter) &&
    (statusFilter === "all" || r.status === statusFilter)
  ), [rows, templateFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: filtered.length,
    sent: filtered.filter(r => r.status === "sent").length,
    failed: filtered.filter(r => r.status === "failed" || r.status === "dlq" || r.status === "bounced").length,
    suppressed: filtered.filter(r => r.status === "suppressed" || r.status === "complained").length,
  }), [filtered]);

  if (isAdmin === null) {
    return <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
    </div>;
  }
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <p className="text-muted-foreground">Admin access required.</p>
        <Button variant="outline" onClick={() => navigate("/dashboard")}>Back to dashboard</Button>
      </div>
    );
  }

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 h-14 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="font-heading text-lg font-semibold text-foreground">Email Activity</h1>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Time range */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {PRESETS.map(p => (
            <Button key={p.days} variant={days===p.days && !customStart ? "default" : "outline"} size="sm"
              onClick={() => { setDays(p.days); setCustomStart(""); setCustomEnd(""); }}>
              {p.label}
            </Button>
          ))}
          <div className="flex items-center gap-2 ml-2">
            <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-8 w-40" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-8 w-40" />
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Total unique emails" value={stats.total} Icon={Mail} tone="default" />
          <StatCard label="Sent" value={stats.sent} Icon={CheckCircle2} tone="success" />
          <StatCard label="Failed / Bounced" value={stats.failed} Icon={XCircle} tone="danger" />
          <StatCard label="Suppressed" value={stats.suppressed} Icon={Ban} tone="warn" />
        </div>

        {/* Template + status filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Select value={templateFilter} onValueChange={setTemplateFilter}>
            <SelectTrigger className="w-56 h-9"><SelectValue placeholder="All templates" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All templates</SelectItem>
              {templates.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="pending">Queued</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="dlq">Failed (retries exhausted)</SelectItem>
              <SelectItem value="bounced">Bounced</SelectItem>
              <SelectItem value="suppressed">Suppressed</SelectItem>
              <SelectItem value="complained">Complaint</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Template</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Recipient</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Status</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">When</th>
                <th className="text-left text-xs font-medium text-muted-foreground uppercase px-4 py-3">Error / Document</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">Loading…</td></tr>
              ) : paged.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-sm text-muted-foreground">No emails match these filters.</td></tr>
              ) : paged.map(r => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 text-sm text-foreground">{r.template_name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{r.recipient_email}</td>
                  <td className="px-4 py-3"><EmailStatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{format(new Date(r.created_at), "MMM d, h:mm a")}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.error_message && <p className="text-destructive break-words max-w-md">{r.error_message}</p>}
                    {r.document_id && (
                      <Link to={`/documents/${r.document_id}`} className="text-primary hover:underline">
                        View document
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
            <span>Page {page + 1} of {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ label, value, Icon, tone }:{
  label: string; value: number; Icon: any;
  tone: "default"|"success"|"danger"|"warn";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    danger:  "text-destructive",
    warn:    "text-amber-600 dark:text-amber-400",
  }[tone];
  return (
    <div className="border border-border rounded-xl p-4 bg-card">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Icon className={`w-4 h-4 ${toneClass}`} />
      </div>
      <p className={`font-heading text-2xl font-bold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}

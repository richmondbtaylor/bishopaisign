import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Download, FileDown, Search, ShieldCheck } from "lucide-react";
import { format } from "date-fns";

type AuditRow = {
  id: string;
  document_id: string;
  action: string;
  actor_email: string | null;
  ip_address: string | null;
  metadata: any;
  created_at: string;
};

type DocRow = { id: string; title: string; status: string };

const prettyAction = (a: string) => a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const AuditLog = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [docs, setDocs] = useState<Record<string, DocRow>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [docFilter, setDocFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const { data: documents } = await supabase
        .from("documents")
        .select("id, title, status")
        .order("created_at", { ascending: false });
      const docMap: Record<string, DocRow> = {};
      (documents || []).forEach((d: any) => (docMap[d.id] = d));
      setDocs(docMap);

      const ids = Object.keys(docMap);
      if (ids.length) {
        const { data } = await supabase
          .from("audit_logs")
          .select("*")
          .in("document_id", ids)
          .order("created_at", { ascending: false })
          .limit(2000);
        setLogs((data as AuditRow[]) || []);
      }
      setLoading(false);
    })();
  }, [user?.id]);

  const actions = useMemo(
    () => Array.from(new Set(logs.map((l) => l.action))).sort(),
    [logs]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (docFilter !== "all" && l.document_id !== docFilter) return false;
      if (actionFilter !== "all" && l.action !== actionFilter) return false;
      if (!q) return true;
      const title = docs[l.document_id]?.title || "";
      return (
        title.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        (l.actor_email || "").toLowerCase().includes(q)
      );
    });
  }, [logs, docs, query, docFilter, actionFilter]);

  const exportCsv = () => {
    const header = ["Timestamp (UTC)", "Document", "Document ID", "Action", "Actor", "IP address", "Details"];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(",")];
    filtered.forEach((l) => {
      lines.push(
        [
          new Date(l.created_at).toISOString(),
          docs[l.document_id]?.title || "",
          l.document_id,
          l.action,
          l.actor_email || "",
          l.ip_address || "",
          l.metadata ? JSON.stringify(l.metadata) : "",
        ].map(esc).join(",")
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = window.document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `signing-audit-log-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadAuditPdf = async (documentId: string) => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        toast({ title: "Please sign in", variant: "destructive" });
        return;
      }
      const url = `https://xevzwyfrgskjigqfvlld.supabase.co/functions/v1/download-audit-pdf?documentId=${documentId}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const link = window.document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `audit-${documentId.slice(0, 8)}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
          <Button size="sm" variant="outline" className="gap-2" onClick={exportCsv} disabled={!filtered.length}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h1 className="font-heading text-2xl font-bold text-foreground">Signing audit log</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Every signing event across your documents: who acted, what they did, and when.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by document, action or person"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={docFilter}
            onChange={(e) => setDocFilter(e.target.value)}
          >
            <option value="all">All documents</option>
            {Object.values(docs).map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="all">All events</option>
            {actions.map((a) => (
              <option key={a} value={a}>{prettyAction(a)}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading audit history...</p>
        ) : !filtered.length ? (
          <p className="text-sm text-muted-foreground">No audit events match your filters yet.</p>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-2">When</th>
                  <th className="text-left font-medium px-4 py-2">Document</th>
                  <th className="text-left font-medium px-4 py-2">Event</th>
                  <th className="text-left font-medium px-4 py-2">Actor</th>
                  <th className="text-left font-medium px-4 py-2 hidden md:table-cell">IP</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-t border-border align-top">
                    <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                      {format(new Date(l.created_at), "MMM d, yyyy h:mm a")}
                    </td>
                    <td className="px-4 py-2">
                      <Link to={`/documents/${l.document_id}`} className="text-foreground hover:text-primary">
                        {docs[l.document_id]?.title || l.document_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="outline">{prettyAction(l.action)}</Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground break-all">{l.actor_email || "System"}</td>
                    <td className="px-4 py-2 text-muted-foreground hidden md:table-cell">{l.ip_address || "-"}</td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" className="gap-1"
                        onClick={() => downloadAuditPdf(l.document_id)}>
                        <FileDown className="w-4 h-4" /> PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};

export default AuditLog;

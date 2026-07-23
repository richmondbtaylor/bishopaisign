import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileSignature, ArrowLeft, LayoutTemplate, Trash2, FileText, Clock, Users, Upload,
} from "lucide-react";
import { format } from "date-fns";
import Papa from "papaparse";
import { useSubscription } from "@/hooks/useSubscription";

type Template = {
  id: string;
  name: string;
  description: string | null;
  file_path: string | null;
  created_at: string;
  updated_at: string;
};

type Row = { name: string; email: string; valid: boolean };

const Templates = () => {
  const { user } = useAuth();
  const { plan, isActive } = useSubscription();
  const isBusiness = isActive && plan === "business";
  const navigate = useNavigate();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const [bulkTemplate, setBulkTemplate] = useState<Template | null>(null);
  const [csvText, setCsvText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => { fetchTemplates(); }, []);

  const fetchTemplates = async () => {
    const { data, error } = await supabase
      .from("templates").select("*").order("updated_at", { ascending: false });
    if (!error && data) setTemplates(data);
    setLoading(false);
  };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase.from("templates").delete().eq("id", id);
    if (!error) {
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast({ title: "Template deleted" });
    }
  };

  const useTemplate = async (template: Template) => {
    if (!user) return;
    try {
      const { data: doc, error } = await supabase.from("documents").insert({
        title: `${template.name} - Copy`,
        sender_id: user.id,
        file_path: template.file_path,
        template_id: template.id,
        status: "draft",
      }).select().single();
      if (error) throw error;

      const { data: templateFields } = await supabase
        .from("template_fields").select("*").eq("template_id", template.id);

      if (templateFields?.length && doc) {
        await supabase.from("document_fields").insert(
          templateFields.map((f: any) => ({
            document_id: doc.id,
            type: f.type,
            x: f.x, y: f.y, width: f.width, height: f.height,
            x_pct: f.x_pct, y_pct: f.y_pct, w_pct: f.w_pct, h_pct: f.h_pct,
            page_number: f.page_number,
            label: f.label, required: f.required, placeholder: f.placeholder,
            options: f.options,
          }))
        );
      }
      toast({ title: "Document created from template" });
      navigate(`/documents/${doc.id}/edit`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const parseCsv = (text: string) => {
    setCsvText(text);
    const parsed = Papa.parse<Record<string, string>>(text.trim(), {
      header: true, skipEmptyLines: true,
    });
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const next: Row[] = (parsed.data || []).map(r => {
      const email = (r.email || r.Email || r.EMAIL || "").trim().toLowerCase();
      const name = (r.name || r.Name || r.NAME || "").trim();
      return { name, email, valid: emailRx.test(email) };
    });
    setRows(next);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    parseCsv(text);
  };

  const submitBulk = async () => {
    if (!bulkTemplate) return;
    const validRows = rows.filter(r => r.valid);
    if (validRows.length === 0) {
      toast({ title: "No valid rows", description: "Add rows with email addresses.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("bulk-send", {
        body: {
          templateId: bulkTemplate.id,
          rows: validRows.map(r => ({ name: r.name || undefined, email: r.email })),
          origin: window.location.hostname === "bishopaisign.lovable.app"
            ? window.location.origin : "https://bishopaisign.lovable.app",
        },
      });
      if (error) {
        // 402 upgrade_required
        const status = (error as any).context?.status;
        if (status === 402) throw new Error("Bulk send requires the Business plan.");
        throw error;
      }
      toast({ title: "Bulk send started", description: `${data.created} document(s) created, ${data.failed} failed.` });
      setBulkTemplate(null);
      setCsvText(""); setRows([]);
    } catch (err: any) {
      toast({ title: "Bulk send failed", description: err.message, variant: "destructive" });
    } finally { setSending(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Link to="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
                <FileSignature className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-heading text-lg font-bold text-foreground">BishopAI Sign</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-heading text-2xl font-bold text-foreground">Templates</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Reuse document layouts with pre-configured fields.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-border rounded-xl">
            <LayoutTemplate className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-heading text-lg font-semibold text-foreground mb-1">No templates yet</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Templates will appear here when you save a document as a template from the editor.
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(template => (
              <div key={template.id} className="border border-border rounded-xl p-5 bg-card hover:shadow-elevated transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <LayoutTemplate className="w-5 h-5 text-primary" />
                  </div>
                  <button
                    onClick={() => deleteTemplate(template.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <h3 className="font-heading font-semibold text-foreground mb-1">{template.name}</h3>
                {template.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{template.description}</p>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                  <Clock className="w-3 h-3" />
                  {format(new Date(template.updated_at), "MMM d, yyyy")}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" className="flex-1 gap-2" onClick={() => useTemplate(template)}>
                    <FileText className="w-3.5 h-3.5" /> Use
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => { setBulkTemplate(template); setCsvText(""); setRows([]); }}
                    title={isBusiness ? "Bulk send" : "Business plan required"}
                  >
                    <Users className="w-3.5 h-3.5" /> Bulk send
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Dialog open={!!bulkTemplate} onOpenChange={(o) => { if (!o) setBulkTemplate(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" /> Bulk send: {bulkTemplate?.name}
            </DialogTitle>
          </DialogHeader>
          {!isBusiness && (
            <div className="rounded-md bg-accent/20 border border-accent/40 p-3 text-sm text-foreground">
              Bulk send is available on the <strong>Business</strong> plan.{" "}
              <Link to="/billing" className="underline font-medium">Upgrade to unlock</Link>.
            </div>
          )}
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste a CSV with columns <code>name,email</code> or upload a .csv file. One document will be created per row.
            </p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Upload CSV</label>
              <input type="file" accept=".csv,text/csv" onChange={onFile}
                className="text-xs file:mr-2 file:rounded file:border file:border-border file:bg-muted file:px-2 file:py-1" />
            </div>
            <Textarea
              placeholder="name,email&#10;Jane Smith,jane@acme.co&#10;John Doe,john@acme.co"
              value={csvText}
              onChange={(e) => parseCsv(e.target.value)}
              className="min-h-[140px] font-mono text-xs"
            />
            {rows.length > 0 && (
              <div className="border border-border rounded-md max-h-56 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Name</th>
                      <th className="text-left px-2 py-1">Email</th>
                      <th className="text-left px-2 py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-2 py-1">{r.name || <span className="text-muted-foreground">-</span>}</td>
                        <td className="px-2 py-1">{r.email}</td>
                        <td className="px-2 py-1">
                          {r.valid ? <span className="text-primary">valid</span>
                            : <span className="text-destructive">invalid email</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {rows.filter(r => r.valid).length} valid of {rows.length} rows.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkTemplate(null)}>Cancel</Button>
            <Button
              onClick={submitBulk}
              disabled={sending || !isBusiness || rows.filter(r => r.valid).length === 0}
              className="gap-2"
            >
              <Upload className="w-4 h-4" /> {sending ? "Sending…" : `Send ${rows.filter(r => r.valid).length} document(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Templates;

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileSignature, Plus, LogOut, FileText, Clock, CheckCircle2, XCircle, Eye, LayoutTemplate,
} from "lucide-react";
import { format } from "date-fns";

type Document = {
  id: string;
  title: string;
  status: string;
  signing_mode: string;
  created_at: string;
  updated_at: string;
};

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  draft: { label: "Draft", variant: "secondary", icon: FileText },
  sent: { label: "Sent", variant: "default", icon: Clock },
  partially_signed: { label: "In Progress", variant: "outline", icon: Eye },
  completed: { label: "Completed", variant: "default", icon: CheckCircle2 },
  declined: { label: "Declined", variant: "destructive", icon: XCircle },
  expired: { label: "Expired", variant: "secondary", icon: Clock },
};

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .order("updated_at", { ascending: false });

    if (!error && data) setDocuments(data);
    setLoading(false);
  };

  const handleNewDocument = () => navigate("/documents/new");

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
              <FileSignature className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-heading text-lg font-bold text-foreground">SignVault</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/templates">
              <Button variant="ghost" size="sm" className="gap-2">
                <LayoutTemplate className="w-4 h-4" /> Templates
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-2">
              <LogOut className="w-4 h-4" /> Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-heading text-2xl font-bold text-foreground">Documents</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Upload, send, and track your documents for signature.
            </p>
          </div>
          <Button onClick={handleNewDocument} className="gap-2">
            <Plus className="w-4 h-4" /> New Document
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-border rounded-xl">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-heading text-lg font-semibold text-foreground mb-1">No documents yet</h3>
            <p className="text-muted-foreground text-sm mb-6">Upload a PDF to get started.</p>
            <Button onClick={handleNewDocument} className="gap-2">
              <Plus className="w-4 h-4" /> New Document
            </Button>
          </div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Document</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Mode</th>
                  <th className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Last Updated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const sc = statusConfig[doc.status] || statusConfig.draft;
                  const Icon = sc.icon;
                  return (
                    <tr key={doc.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/documents/${doc.id}`} className="font-medium text-foreground hover:text-primary transition-colors">
                          {doc.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={sc.variant} className="gap-1">
                          <Icon className="w-3 h-3" /> {sc.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground capitalize">{doc.signing_mode}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {format(new Date(doc.updated_at), "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/documents/${doc.id}`}>
                          <Button variant="ghost" size="sm">Open</Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};

export default Dashboard;

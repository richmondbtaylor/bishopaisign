import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, FileSignature, Copy, CheckCircle2, Clock, Eye, XCircle,
  FileText, Send, Trash2, ExternalLink,
} from "lucide-react";
import { format } from "date-fns";

const DocumentView = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [document, setDocument] = useState<any>(null);
  const [signers, setSigners] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) loadDocument(id);
  }, [id]);

  const loadDocument = async (docId: string) => {
    const [docRes, signersRes, auditRes] = await Promise.all([
      supabase.from("documents").select("*").eq("id", docId).single(),
      supabase.from("document_signers").select("*").eq("document_id", docId).order("signing_order"),
      supabase.from("audit_logs").select("*").eq("document_id", docId).order("created_at", { ascending: false }),
    ]);
    if (docRes.data) setDocument(docRes.data);
    if (signersRes.data) setSigners(signersRes.data);
    if (auditRes.data) setAuditLogs(auditRes.data);
    setLoading(false);
  };

  const downloadCompleted = async () => {
    if (!document?.completed_file_path) return;
    const { data } = await supabase.storage.from("documents")
      .createSignedUrl(document.completed_file_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const copySigningLink = (token: string) => {
    const url = `${window.location.origin}/sign/${token}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied", description: "Signing link copied to clipboard." });
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "signed": return <CheckCircle2 className="w-4 h-4 text-primary" />;
      case "viewed": return <Eye className="w-4 h-4 text-amber-500" />;
      case "sent": return <Send className="w-4 h-4 text-blue-500" />;
      case "declined": return <XCircle className="w-4 h-4 text-destructive" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!document) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Document not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 h-14 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="font-heading text-lg font-semibold text-foreground">{document.title}</h1>
        <Badge variant={document.status === "completed" ? "default" : "secondary"} className="ml-2 capitalize">
          {document.status.replace("_", " ")}
        </Badge>
        {document.completed_file_path && (
          <Button size="sm" variant="outline" className="ml-auto gap-2" onClick={downloadCompleted}>
            <ExternalLink className="w-3.5 h-3.5" /> Download Signed PDF
          </Button>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Document details */}
        <div className="grid md:grid-cols-2 gap-8">
          {/* Signers */}
          <div>
            <h2 className="font-heading text-lg font-semibold text-foreground mb-4">Signers</h2>
            <div className="space-y-3">
              {signers.map((signer) => (
                <div key={signer.id} className="border border-border rounded-lg p-4 bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {statusIcon(signer.status)}
                      <span className="font-medium text-foreground text-sm">
                        {signer.name || signer.email}
                      </span>
                    </div>
                    <Badge variant="outline" className="capitalize text-xs">{signer.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{signer.email}</p>
                  {signer.signed_at && (
                    <p className="text-xs text-muted-foreground">
                      Signed {format(new Date(signer.signed_at), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  )}
                  {signer.status !== "signed" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 gap-1 text-xs"
                      onClick={() => copySigningLink(signer.token)}
                    >
                      <Copy className="w-3 h-3" /> Copy Signing Link
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {document.status === "draft" && (
              <Button
                className="mt-4 gap-2"
                onClick={() => navigate(`/documents/${document.id}/edit`)}
              >
                <FileText className="w-4 h-4" /> Edit & Send
              </Button>
            )}
          </div>

          {/* Audit Trail */}
          <div>
            <h2 className="font-heading text-lg font-semibold text-foreground mb-4">Audit Trail</h2>
            {auditLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events yet.</p>
            ) : (
              <div className="space-y-2">
                {auditLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 text-sm">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div>
                      <p className="text-foreground font-medium">{log.action.replace(/_/g, " ")}</p>
                      <p className="text-xs text-muted-foreground">
                        {log.actor_email && `${log.actor_email} · `}
                        {format(new Date(log.created_at), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default DocumentView;

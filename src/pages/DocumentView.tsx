import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import EmailTimeline from "@/components/EmailTimeline";
import {
  ArrowLeft, FileSignature, Copy, CheckCircle2, Clock, Eye, XCircle,
  FileText, Send, Trash2, ExternalLink, Mail, RefreshCw, Bell,
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
  const [resendingAll, setResendingAll] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [remindingId, setRemindingId] = useState<string | null>(null);

  const sendReminderNow = async (signer: any) => {
    if (!document) return;
    setRemindingId(signer.id);
    try {
      const signingUrl = `${publicOrigin()}/sign/${document.id}?token=${signer.token}`;
      const { error } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "reminder",
          recipientEmail: signer.email,
          documentId: document.id,
          signerId: signer.id,
          idempotencyKey: `reminder-manual-${signer.id}-${Date.now()}`,
          templateData: {
            senderName: (user?.user_metadata as any)?.full_name || user?.email || "BishopAI Sign",
            documentTitle: document.title,
            signingUrl,
            recipientName: signer.name || undefined,
          },
        },
      });
      if (error) throw error;
      await supabase.from("audit_logs").insert({
        document_id: document.id, action: "reminder_sent_manual",
        actor_email: signer.email, metadata: { by: user?.email },
      });
      toast({ title: "Reminder sent", description: `To ${signer.name || signer.email}.` });
      loadDocument(document.id);
    } catch (err: any) {
      toast({ title: "Reminder failed", description: err.message, variant: "destructive" });
    } finally {
      setRemindingId(null);
    }
  };

  const publicOrigin = () =>
    window.location.hostname === "bishopaisign.lovable.app"
      ? window.location.origin
      : "https://bishopaisign.lovable.app";

  const resend = async (signer?: any) => {
    if (!document) return;
    try {
      if (signer) setResendingId(signer.id);
      else setResendingAll(true);
      const body: any = { documentId: document.id, origin: publicOrigin() };
      if (signer) body.onlySignerOrder = signer.signing_order;
      const { error } = await supabase.functions.invoke("send-sign-request", { body });
      if (error) throw error;
      toast({
        title: "Invitation resent",
        description: signer
          ? `Sent to ${signer.name || signer.email}.`
          : document.signing_mode === "sequential"
            ? "Sent to the next pending signer."
            : "Sent to all pending signers.",
      });
      loadDocument(document.id);
    } catch (err: any) {
      toast({ title: "Resend failed", description: err.message, variant: "destructive" });
    } finally {
      setResendingId(null);
      setResendingAll(false);
    }
  };

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
    const filename = `${document.title || "document"}-signed.pdf`;
    const { data, error } = await supabase.storage.from("documents")
      .createSignedUrl(document.completed_file_path, 300, { download: filename });
    if (error || !data?.signedUrl) {
      toast({ title: "Download failed", description: error?.message || "Could not create link", variant: "destructive" });
      return;
    }
    const link = window.document.createElement("a");
    link.href = data.signedUrl;
    link.download = filename;
    link.rel = "noopener";
    window.document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const downloadAuditPdf = async () => {
    if (!document) return;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { toast({ title: "Please sign in", variant: "destructive" }); return; }
      const url = `https://xevzwyfrgskjigqfvlld.supabase.co/functions/v1/download-audit-pdf?documentId=${document.id}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const link = window.document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `audit-${document.id.slice(0, 8)}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
      await supabase.from("audit_logs").insert({
        document_id: document.id,
        action: "audit_pdf_downloaded",
        actor_email: user?.email ?? null,
      });
      loadDocument(document.id);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  };

  const copySigningLink = (signer: any) => {
    const url = `${publicOrigin()}/sign/${document.id}?token=${signer.token}`;
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
        <div className="ml-auto flex items-center gap-2">
          {(document.status === "sent" || document.status === "in_progress") && (
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => resend()}
              disabled={resendingAll}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${resendingAll ? "animate-spin" : ""}`} />
              {resendingAll ? "Resending…" : "Resend"}
            </Button>
          )}
          {document.completed_file_path && (
            <Button size="sm" variant="outline" className="gap-2" onClick={downloadCompleted}>
              <ExternalLink className="w-3.5 h-3.5" /> Download Signed PDF
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-2" onClick={downloadAuditPdf}>
            <FileText className="w-3.5 h-3.5" /> Audit PDF
          </Button>
        </div>
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
                  {signer.status !== "signed" && signer.status !== "declined" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-xs"
                        onClick={() => copySigningLink(signer)}
                      >
                        <Copy className="w-3 h-3" /> Copy Link
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 text-xs"
                        onClick={() => resend(signer)}
                        disabled={resendingId === signer.id}
                      >
                        <RefreshCw className={`w-3 h-3 ${resendingId === signer.id ? "animate-spin" : ""}`} />
                        {resendingId === signer.id ? "Resending…" : "Resend Email"}
                      </Button>
                    </div>
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

        {/* Reissue activity */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <RefreshCw className="w-4 h-4 text-primary" />
            <h2 className="font-heading text-lg font-semibold text-foreground">Signing Link Reissues</h2>
          </div>
          {(() => {
            const reissues = auditLogs.filter((l) =>
              l.action === "signing_link_reissued" || l.action === "signing_link_reissue_requested"
            );
            if (reissues.length === 0) {
              return <p className="text-sm text-muted-foreground">No reissue attempts yet.</p>;
            }
            return (
              <div className="border border-border rounded-lg bg-card divide-y divide-border">
                {reissues.map((l) => {
                  const md = l.metadata || {};
                  const issued = l.action === "signing_link_reissued";
                  return (
                    <div key={l.id} className="p-3 flex items-start justify-between gap-3 text-sm">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant={issued ? "default" : "outline"} className="capitalize text-xs">
                            {issued ? "reissued" : md.matched ? "requested" : "request (no match)"}
                          </Badge>
                          <span className="text-foreground font-medium">{l.actor_email || "unknown"}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Reason: <span className="capitalize">{md.reason || "unspecified"}</span>
                          {l.ip_address && <> · IP {l.ip_address}</>}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(l.created_at), "MMM d, h:mm a")}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* Completion timeline */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <h2 className="font-heading text-lg font-semibold text-foreground">Completion Timeline</h2>
          </div>
          {(() => {
            const items: { ts: string; label: string; sub?: string }[] = [];
            signers.forEach((s) => {
              if (s.signed_at) items.push({
                ts: s.signed_at,
                label: `${s.name || s.email} signed`,
                sub: s.email,
              });
              if (s.declined_at) items.push({
                ts: s.declined_at,
                label: `${s.name || s.email} declined`,
                sub: s.decline_reason || undefined,
              });
            });
            auditLogs
              .filter((l) => l.action === "completion_email_sent" || l.action === "document_completed")
              .forEach((l) => items.push({
                ts: l.created_at,
                label: l.action === "document_completed" ? "Document finalized" : `Completion email sent to ${l.actor_email}`,
              }));
            items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
            if (items.length === 0) {
              return <p className="text-sm text-muted-foreground">No completion events yet.</p>;
            }
            return (
              <div className="border border-border rounded-lg bg-card divide-y divide-border">
                {items.map((it, i) => (
                  <div key={i} className="p-3 flex items-start justify-between gap-3 text-sm">
                    <div>
                      <p className="text-foreground font-medium">{it.label}</p>
                      {it.sub && <p className="text-xs text-muted-foreground mt-0.5">{it.sub}</p>}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(it.ts), "MMM d, h:mm a")}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Email delivery timeline */}

        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-4 h-4 text-primary" />
            <h2 className="font-heading text-lg font-semibold text-foreground">Email Delivery</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Every invitation and notification sent for this document, including bounces and provider errors.
          </p>
          <EmailTimeline documentId={document.id} />
        </div>
      </main>
    </div>
  );
};

export default DocumentView;

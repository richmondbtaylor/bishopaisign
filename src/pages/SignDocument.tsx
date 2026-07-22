import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  FileSignature, CheckCircle2, Clock, XCircle, AlertTriangle, Calendar, Type, Undo2, Check,
} from "lucide-react";

const SIGNATURE_FONTS = [
  { css: "'Dancing Script', cursive", label: "Dancing Script" },
  { css: "'Great Vibes', cursive", label: "Great Vibes" },
  { css: "'Pacifico', cursive", label: "Pacifico" },
];

const getPageWidth = () => {
  if (typeof window === "undefined") return 800;
  // Full width on mobile, capped on larger screens
  return Math.min(820, window.innerWidth - 24);
};


const todayFormatted = () => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

type FieldSig = { method: "type"; name: string; font: string };

const SignDocument = () => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryToken = searchParams.get("token");
  const singleSegment = params.documentId && !params.token ? params.documentId : null;
  const routeToken = queryToken || params.token || (!queryToken ? singleSegment : null) || null;
  const routeDocumentId = queryToken ? (singleSegment || searchParams.get("documentId")) : searchParams.get("documentId");
  const { toast } = useToast();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<
    "ok" | "waiting" | "expired" | "declined" | "signed" | "invalid" | "mismatch"
  >("ok");
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [signer, setSigner] = useState<any>(null);
  const [doc, setDoc] = useState<any>(null);
  const [fields, setFields] = useState<any[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [numPages, setNumPages] = useState<number>(0);
  const [pageDims, setPageDims] = useState<Record<number, { w: number; h: number }>>({});
  const [viewportW, setViewportW] = useState<number>(typeof window !== "undefined" ? window.innerWidth : 800);
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  const [errorDocumentId, setErrorDocumentId] = useState<string | null>(null);
  const [errorSignerEmail, setErrorSignerEmail] = useState<string | null>(null);

  // Per-field values
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [fieldSignatures, setFieldSignatures] = useState<Record<string, FieldSig>>({});

  // Field-click signature dialog
  const [sigDialogFieldId, setSigDialogFieldId] = useState<string | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [dialogFont, setDialogFont] = useState(SIGNATURE_FONTS[0].css);

  // Field-click text dialog (for text fields like printed name, title, etc.)
  const [textDialogField, setTextDialogField] = useState<any | null>(null);
  const [textDialogValue, setTextDialogValue] = useState("");

  // Field-click date dialog
  const [dateDialogField, setDateDialogField] = useState<any | null>(null);
  const [dateDialogValue, setDateDialogValue] = useState("");

  // One-level undo of the last field change
  type UndoEntry =
    | { kind: "value"; id: string; prev: string | undefined; label: string }
    | { kind: "signature"; id: string; prev: FieldSig | undefined; label: string };
  const [lastEdit, setLastEdit] = useState<UndoEntry | null>(null);

  // Review screen
  const [reviewOpen, setReviewOpen] = useState(false);

  // Reissue flow
  const [reissueOpen, setReissueOpen] = useState(false);
  const [reissueEmail, setReissueEmail] = useState("");
  const [reissueSending, setReissueSending] = useState(false);
  const [reissueSent, setReissueSent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [challengeAnswer, setChallengeAnswer] = useState("");
  const challenge = useMemo(
    () => ({ a: Math.floor(Math.random() * 8) + 1, b: Math.floor(Math.random() * 8) + 1 }),
    [reissueOpen, state]
  );

  useEffect(() => { if (routeToken) loadSigningData(routeToken, routeDocumentId); }, [routeToken, routeDocumentId]);

  const loadSigningData = async (signerToken: string, expectedDocumentId: string | null) => {
    try {
      const { data, error } = await supabase.functions.invoke("signing-session", {
        body: { token: signerToken, documentId: expectedDocumentId ?? undefined },
      });
      if (error) {
        let body: any = null;
        try { body = (error as any).context ? await (error as any).context.json() : null; } catch { /* ignore */ }
        const status = (error as any).context?.status;
        if (body?.documentId) setErrorDocumentId(body.documentId);
        if (body?.reason === "mismatch" || status === 409) { setState("mismatch"); setLoading(false); return; }
        if (status === 410) { setState("expired"); setLoading(false); return; }
        setState("invalid"); setLoading(false); return;
      }
      if (!data?.signer) { setState("invalid"); setLoading(false); return; }
      setSigner(data.signer);
      setDoc(data.document);
      setErrorDocumentId(data.document?.id ?? null);
      setFields(data.fields || []);
      // Default: the signer's name as initial dialog value
      setDialogName(data.signer?.name || "");
      if (data.pdfUrl) setPdfUrl(data.pdfUrl);
      if (data.waiting) { setState("waiting"); setWaitingFor(data.waitingFor || null); }
      else if (data.signer.status === "signed") setState("signed");
      else if (data.signer.status === "declined") setState("declined");
      else setState("ok");
    } catch (err) {
      console.error(err);
      setState("invalid");
    }
    setLoading(false);
  };

  const publicOrigin = () =>
    window.location.hostname === "bishopaisign.lovable.app"
      ? window.location.origin
      : "https://bishopaisign.lovable.app";

  useEffect(() => {
    if (reissueEmail) return;
    if (user?.email) setReissueEmail(user.email);
    else if (errorSignerEmail) setReissueEmail(errorSignerEmail);
  }, [user, errorSignerEmail]);

  const currentReason = state === "mismatch" ? "mismatch" : state === "expired" ? "expired" : "invalid";

  const requestNewLink = async () => {
    const email = reissueEmail.trim().toLowerCase();
    if (!email) { toast({ title: "Enter your email", variant: "destructive" }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "Invalid email format", variant: "destructive" }); return;
    }
    if (errorSignerEmail && errorSignerEmail.toLowerCase() !== email) {
      toast({ title: "Email doesn't match the invite",
        description: `This link was sent to ${errorSignerEmail}.`, variant: "destructive" });
      return;
    }
    if (!challengeAnswer || Number(challengeAnswer) !== challenge.a + challenge.b) {
      toast({ title: "Answer the verification question", variant: "destructive" }); return;
    }
    const targetDocId = errorDocumentId || routeDocumentId;
    if (!targetDocId) {
      toast({ title: "Can't reissue this link", description: "Ask the sender to resend it.", variant: "destructive" });
      return;
    }
    setReissueSending(true);
    try {
      const { error } = await supabase.functions.invoke("request-new-link", {
        body: { documentId: targetDocId, token: routeToken, email, origin: publicOrigin(),
          reason: currentReason, hp_field: honeypot,
          challenge: { a: challenge.a, b: challenge.b, answer: Number(challengeAnswer) } },
      });
      if (error) throw error;
      setReissueSent(true);
      toast({ title: "Check your inbox", description: "A fresh signing link is on its way." });
    } catch (err: any) {
      const msg = err?.message?.includes("429") || /too many/i.test(err?.message || "")
        ? "You've requested too many new links. Try again in an hour." : err.message;
      toast({ title: "Couldn't send new link", description: msg, variant: "destructive" });
    } finally { setReissueSending(false); }
  };

  const openFieldDialog = (field: any) => {
    if (field.type === "signature") {
      const existing = fieldSignatures[field.id];
      setDialogName(existing?.name || signer?.name || "");
      setDialogFont(existing?.font || SIGNATURE_FONTS[0].css);
      setSigDialogFieldId(field.id);
    } else if (field.type === "date") {
      setDateDialogValue(fieldValues[field.id] || todayFormatted());
      setDateDialogField(field);
    } else if (field.type === "text") {
      const lbl = (field.label || "").toLowerCase();
      const suggested = fieldValues[field.id]
        || (lbl.includes("name") ? (signer?.name || "") : "");
      setTextDialogValue(suggested);
      setTextDialogField(field);
    }
  };

  const scrollToField = (id: string) => {
    setTimeout(() => {
      const el = window.document.querySelector(`[data-field-id="${id}"]`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Restore keyboard focus for accessibility
        el.focus({ preventScroll: true });
      }
    }, 120);
  };

  const scrollToNextUnfilled = (afterId?: string) => {
    setTimeout(() => {
      const nextSig = sigFields.find(f => f.id !== afterId && !fieldSignatures[f.id]);
      const nextTxt = textFields.find(f => f.id !== afterId && f.required && !fieldValues[f.id]);
      const next = nextSig || nextTxt;
      if (!next) return;
      const el = window.document.querySelector(`[data-field-id="${next.id}"]`) as HTMLElement | null;
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus({ preventScroll: true }); }
    }, 200);
  };

  const confirmTextDialog = () => {
    if (!textDialogField) return;
    if (textDialogField.required && !textDialogValue.trim()) {
      toast({ title: "This field is required", variant: "destructive" }); return;
    }
    const id = textDialogField.id;
    const prev = fieldValues[id];
    const label = textDialogField.label || "Text";
    setFieldValues(p => ({ ...p, [id]: textDialogValue.trim() }));
    setLastEdit({ kind: "value", id, prev, label });
    setTextDialogField(null);
    scrollToField(id);
  };

  const confirmDateDialog = () => {
    if (!dateDialogField) return;
    if (!dateDialogValue.trim()) {
      toast({ title: "Pick a date", variant: "destructive" }); return;
    }
    const id = dateDialogField.id;
    const prev = fieldValues[id];
    setFieldValues(p => ({ ...p, [id]: dateDialogValue.trim() }));
    setLastEdit({ kind: "value", id, prev, label: "Date" });
    setDateDialogField(null);
    scrollToField(id);
  };

  const confirmSignatureDialog = () => {
    if (!sigDialogFieldId) return;
    if (!dialogName.trim()) {
      toast({ title: "Type your name", variant: "destructive" }); return;
    }
    const currentId = sigDialogFieldId;
    const prev = fieldSignatures[currentId];
    setFieldSignatures(p => ({
      ...p,
      [currentId]: { method: "type", name: dialogName.trim(), font: dialogFont },
    }));
    setLastEdit({ kind: "signature", id: currentId, prev, label: "Signature" });
    // Auto-fill any date fields assigned to this signer that are still empty
    setFieldValues(prev => {
      const next = { ...prev };
      fields.filter(f => f.type === "date" && !next[f.id]).forEach(f => {
        next[f.id] = todayFormatted();
      });
      return next;
    });
    setSigDialogFieldId(null);
    scrollToField(currentId);
  };

  const undoLastEdit = () => {
    if (!lastEdit) return;
    if (lastEdit.kind === "value") {
      setFieldValues(p => {
        const next = { ...p };
        if (lastEdit.prev === undefined) delete next[lastEdit.id];
        else next[lastEdit.id] = lastEdit.prev;
        return next;
      });
    } else {
      setFieldSignatures(p => {
        const next = { ...p };
        if (lastEdit.prev === undefined) delete next[lastEdit.id];
        else next[lastEdit.id] = lastEdit.prev;
        return next;
      });
    }
    scrollToField(lastEdit.id);
    setLastEdit(null);
    toast({ title: "Change reverted" });
  };

  const handleDecline = async () => {
    if (!declineReason.trim()) { toast({ title: "Please provide a reason", variant: "destructive" }); return; }
    try {
      const { data, error } = await supabase.functions.invoke("decline-signature", {
        body: { token: routeToken, reason: declineReason },
      });
      if (error || !data?.success) throw new Error((error as any)?.message || "Failed to decline");
      setDeclineOpen(false); setState("declined");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const sigFields = fields.filter(f => f.type === "signature");
  const textFields = fields.filter(f => f.type === "text" || f.type === "date");
  const missingSigs = sigFields.filter(f => !fieldSignatures[f.id]);
  const missingText = textFields.filter(f => f.required && !fieldValues[f.id]);
  const canFinish = missingSigs.length === 0 && missingText.length === 0;

  const openReview = () => {
    if (!canFinish) {
      toast({
        title: "Almost there",
        description: `Complete ${missingSigs.length + missingText.length} more field(s).`,
        variant: "destructive",
      });
      return;
    }
    setReviewOpen(true);
  };

  const finalSubmit = async () => {
    if (!signer || !doc) return;
    setSubmitting(true);
    try {
      // Legacy signatureData fallback = first sig, for older backend paths
      const first = Object.values(fieldSignatures)[0];
      const { data, error } = await supabase.functions.invoke("submit-signature", {
        body: {
          token: routeToken,
          fieldValues,
          signatures: fieldSignatures,
          signatureData: first || { method: "type", name: signer.name || "", font: SIGNATURE_FONTS[0].css },
          typedName: first?.name || signer.name,
        },
      });
      if (error || !data?.success) throw new Error((error as any)?.message || data?.error || "Failed to submit");
      setReviewOpen(false);
      setState("signed");
      toast({ title: "Document signed!", description: "Thank you for signing." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state === "signed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground mb-2">Document Signed</h1>
          <p className="text-muted-foreground">Your signature has been recorded. You'll receive a copy when everyone has signed.</p>
        </div>
      </div>
    );
  }

  if (state === "waiting") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-6">
            <Clock className="w-8 h-8 text-accent" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground mb-2">Waiting your turn</h1>
          <p className="text-muted-foreground">
            {waitingFor
              ? `This document must be signed by ${waitingFor} first.`
              : "This document must be signed in order."}
          </p>
        </div>
      </div>
    );
  }

  if (state === "declined") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <XCircle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground mb-2">Signing declined</h1>
          <p className="text-muted-foreground">The sender has been notified.</p>
        </div>
      </div>
    );
  }

  if (state === "expired" || state === "invalid" || state === "mismatch" || !signer || !doc) {
    const isMismatch = state === "mismatch";
    const isExpired = state === "expired";
    const title = isMismatch ? "Link doesn't match this document"
      : isExpired ? "Link expired" : "Invalid or used link";
    const subtitle = isMismatch
      ? "This signing URL points to a different document. Request a fresh link and we'll email it to you."
      : isExpired
        ? "This signing link has expired. Enter your email and we'll send you a fresh one."
        : "This signing link is invalid, has already been used, or was replaced. Request a new link below.";

    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground mb-2">{title}</h1>
          <p className="text-muted-foreground mb-6">{subtitle}</p>

          {reissueSent ? (
            <div className="rounded-lg border border-border bg-card p-6 text-left">
              <div className="flex items-center gap-2 text-primary mb-2">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">Request received</span>
              </div>
              <p className="text-sm text-muted-foreground">
                If <strong>{reissueEmail}</strong> is on this document, a fresh signing link is on its way.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card p-6 text-left space-y-3">
              <label className="text-sm font-medium text-foreground block">Your email address</label>
              <Input type="email" placeholder="you@company.com" value={reissueEmail}
                onChange={(e) => setReissueEmail(e.target.value)} autoFocus />
              <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true"
                value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
                style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
              <label className="text-sm font-medium text-foreground block">
                Quick check: what is {challenge.a} + {challenge.b}?
              </label>
              <Input type="number" inputMode="numeric" placeholder="Answer"
                value={challengeAnswer} onChange={(e) => setChallengeAnswer(e.target.value)} />
              <Button className="w-full gap-2" onClick={requestNewLink}
                disabled={reissueSending || (!errorDocumentId && !routeDocumentId)}>
                <FileSignature className="w-4 h-4" />
                {reissueSending ? "Sending..." : "Send me a new signing link"}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const renderOverlayField = (field: any, pageWidthPx: number, pageHeightPx: number) => {
    const left = (field.x_pct ?? 0) * pageWidthPx;
    const top = (field.y_pct ?? 0) * pageHeightPx;
    const width = (field.w_pct ?? 0.2) * pageWidthPx;
    const height = (field.h_pct ?? 0.05) * pageHeightPx;

    const sig = fieldSignatures[field.id];
    const val = fieldValues[field.id];
    const filled = field.type === "signature" ? !!sig : !!val;
    const clickable = field.type === "signature" || field.type === "date" || field.type === "text";

    const typeLabel =
      field.type === "signature" ? "Signature" :
      field.type === "date" ? "Date" :
      (field.label || "Text");
    const statusText = filled ? "completed" : (field.required ? "required, not completed" : "optional, not completed");

    return (
      <button
        key={field.id}
        type="button"
        data-field-id={field.id}
        onClick={() => clickable && openFieldDialog(field)}
        className={`absolute z-20 rounded border-2 flex items-center justify-center px-1 overflow-hidden transition-colors touch-manipulation active:scale-[0.98] cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
          filled
            ? "border-primary bg-primary/5 text-foreground"
            : "border-accent bg-accent/30 text-accent-foreground hover:bg-accent/40 animate-pulse ring-2 ring-accent/50 shadow-md"
        }`}
        style={{ left, top, width, height: Math.max(height, 28) }}
        aria-label={`${typeLabel} field, ${statusText}. Press Enter to ${filled ? "edit" : "complete"}.`}
        aria-pressed={filled}
        title={filled ? "Click to change" : `${typeLabel}${field.required ? " (required)" : " (optional)"} – click to complete`}
      >
        {/* Status badge */}
        <span
          aria-hidden="true"
          className={`absolute -top-2 -left-2 w-5 h-5 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-bold shadow ${
            filled ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
          }`}
        >
          {filled ? <Check className="w-3 h-3" /> : (field.required ? "!" : "?")}
        </span>
        {field.type === "signature" ? (
          sig ? (
            <span
              className="truncate leading-none"
              style={{ fontFamily: sig.font, fontSize: Math.max(12, height * 0.7), color: "#1B2A4A" }}
            >
              {sig.name}
            </span>
          ) : (
            <span className="text-[10px] font-medium">Click to sign</span>
          )
        ) : field.type === "date" ? (
          val ? (
            <span className="text-[11px] font-medium">{val}</span>
          ) : (
            <span className="text-[10px] font-medium">Click for date</span>
          )
        ) : val ? (
          <span className="text-[11px] truncate">{val}</span>
        ) : (
          <span className="text-[10px] font-medium">{field.label || "text"}</span>
        )}
      </button>
    );
  };

  const totalFields = sigFields.length + textFields.length;
  const completedFields = sigFields.filter(f => fieldSignatures[f.id]).length
    + textFields.filter(f => fieldValues[f.id]).length;

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="border-b border-border bg-card px-4 h-14 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <FileSignature className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-heading text-lg font-bold text-foreground">BishopAI Sign</span>
        </div>
        <span className="text-sm text-muted-foreground truncate max-w-[50%]">{doc.title}</span>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="font-heading text-xl font-bold text-foreground mb-1">Please review and sign</h1>
          <p className="text-sm text-muted-foreground">
            Signing as <strong>{signer.name || signer.email}</strong> · {completedFields}/{totalFields} fields complete
          </p>
        </div>

        {pdfUrl && (
          <div className="mb-8 space-y-4">
            <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)}>
              {Array.from({ length: numPages }, (_, i) => {
                const pageNum = i + 1;
                const dims = pageDims[pageNum];
                const pageWidth = getPageWidth();
                return (
                  <div key={pageNum} className="relative rounded-xl overflow-hidden border border-border mx-auto [&_.react-pdf__Page__textContent]:pointer-events-none [&_.react-pdf__Page__annotations]:pointer-events-none" style={{ width: pageWidth, maxWidth: "100%" }}>
                    <Page pageNumber={pageNum} width={pageWidth} renderTextLayer={false} renderAnnotationLayer={false}
                      onLoadSuccess={(p) => setPageDims(prev => ({ ...prev, [pageNum]: { w: p.width, h: p.height } }))} />
                    {dims && fields.filter(f => f.page_number === pageNum).map(f => renderOverlayField(f, dims.w, dims.h))}
                  </div>
                );
              })}
            </Document>
          </div>
        )}

        {textFields.filter(f => f.type === "text").length > 0 && (
          <div className="mb-8 space-y-4">
            <h2 className="font-heading text-lg font-semibold text-foreground">Text fields</h2>
            {textFields.filter(f => f.type === "text").map((field) => (
              <div key={field.id}>
                <label className="text-sm font-medium text-foreground mb-1 block">
                  {field.label || "text"} {field.required && <span className="text-destructive">*</span>}
                </label>
                <Input value={fieldValues[field.id] || ""} className="h-12 text-base"
                  onChange={(e) => setFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 inset-x-0 border-t border-border bg-card/95 backdrop-blur z-30 pb-[env(safe-area-inset-bottom)]">
        {/* Progress bar */}
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: totalFields ? `${(completedFields / totalFields) * 100}%` : "0%" }}
          />
        </div>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="lg" className="gap-2 shrink-0">
                <XCircle className="w-4 h-4" /> <span className="hidden sm:inline">Decline</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Decline to sign</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">The sender will be notified with your reason.</p>
              <Textarea placeholder="Reason for declining..." value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)} className="text-base" />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDeclineOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDecline}>Decline</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="flex-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{completedFields}/{totalFields}</span>{" "}
            {canFinish ? "ready to review" : "fields complete"}
          </div>

          <Button size="lg" onClick={openReview} disabled={!canFinish} className="gap-2 flex-1 sm:flex-none sm:px-8">
            <FileSignature className="w-4 h-4" /> {canFinish ? "Review & Finish" : "Sign fields"}
          </Button>
        </div>
      </div>

      {/* Signature dialog (opens on field click) */}
      <Dialog open={!!sigDialogFieldId} onOpenChange={(o) => !o && setSigDialogFieldId(null)}>
        <DialogContent className="max-w-md w-[calc(100vw-1rem)] max-h-[92vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Type className="w-4 h-4" /> Adopt your signature
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Full name</label>
              <Input
                placeholder="Type your full name"
                value={dialogName}
                onChange={(e) => setDialogName(e.target.value)}
                autoFocus
                autoComplete="name"
                autoCapitalize="words"
                className="h-12 text-base"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Pick a style</label>
              <div className="grid grid-cols-1 gap-2">
                {SIGNATURE_FONTS.map((f) => (
                  <button
                    key={f.css}
                    type="button"
                    onClick={() => setDialogFont(f.css)}
                    className={`px-4 py-4 border-2 rounded-lg text-left transition-colors touch-manipulation ${
                      dialogFont === f.css ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="block text-3xl leading-none text-foreground truncate" style={{ fontFamily: f.css }}>
                      {dialogName || "Your name"}
                    </span>
                    <span className="text-xs text-muted-foreground mt-1 block">{f.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              By adopting, you agree this is your legal signature (ESIGN Act / UETA).
            </p>
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setSigDialogFieldId(null)} className="w-full sm:w-auto">Cancel</Button>
            <Button onClick={confirmSignatureDialog} className="gap-2 w-full sm:w-auto" size="lg">
              <CheckCircle2 className="w-4 h-4" /> Adopt & place
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Text-field dialog (printed name, title, generic text) */}
      <Dialog open={!!textDialogField} onOpenChange={(o) => !o && setTextDialogField(null)}>
        <DialogContent className="max-w-md w-[calc(100vw-1rem)] p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Type className="w-4 h-4" /> {textDialogField?.label || "Enter text"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground block">
              {textDialogField?.label || "Value"}
              {textDialogField?.required && <span className="text-destructive"> *</span>}
            </label>
            <Input
              value={textDialogValue}
              onChange={(e) => setTextDialogValue(e.target.value)}
              placeholder={textDialogField?.label || "Type here"}
              className="h-12 text-base"
              autoFocus
              autoCapitalize="words"
              onKeyDown={(e) => { if (e.key === "Enter") confirmTextDialog(); }}
            />
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setTextDialogField(null)} className="w-full sm:w-auto">Cancel</Button>
            <Button onClick={confirmTextDialog} size="lg" className="gap-2 w-full sm:w-auto">
              <CheckCircle2 className="w-4 h-4" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review dialog */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-lg w-[calc(100vw-1rem)] max-h-[92vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Review before finishing</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {sigFields.map((f) => {
              const s = fieldSignatures[f.id];
              return (
                <div key={f.id} className="border border-border rounded-lg p-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Signature · page {f.page_number}</p>
                    {s ? (
                      <span className="text-2xl leading-tight text-foreground" style={{ fontFamily: s.font }}>
                        {s.name}
                      </span>
                    ) : <span className="text-sm text-destructive">Not signed</span>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setReviewOpen(false); openFieldDialog(f); }}>
                    Edit
                  </Button>
                </div>
              );
            })}
            {textFields.map((f) => (
              <div key={f.id} className="border border-border rounded-lg p-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    {f.type === "date" && <Calendar className="w-3 h-3" />}
                    {f.label || f.type} · page {f.page_number}
                  </p>
                  <p className="text-sm text-foreground">{fieldValues[f.id] || "—"}</p>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setReviewOpen(false)} className="w-full sm:w-auto">Back</Button>
            <Button onClick={finalSubmit} disabled={submitting} size="lg" className="gap-2 w-full sm:w-auto">
              <FileSignature className="w-4 h-4" />
              {submitting ? "Signing..." : "Finish signing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SignDocument;

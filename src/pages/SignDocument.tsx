import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
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
import {
  FileSignature, CheckCircle2, PenTool, Type, Upload as UploadIcon,
  Clock, XCircle, AlertTriangle,
} from "lucide-react";

type SignatureMethod = "type" | "draw" | "upload";

const SIGNATURE_FONTS = [
  "'Dancing Script', cursive",
  "'Great Vibes', cursive",
  "'Pacifico', cursive",
];

const PAGE_WIDTH = Math.min(800, typeof window !== "undefined" ? window.innerWidth - 32 : 800);

const SignDocument = () => {
  const params = useParams();
  const [searchParams] = useSearchParams();
  // Stable route: /sign/:documentId?token=... plus legacy /sign/:token.
  const routeToken = params.token || searchParams.get("token") || null;
  const routeDocumentId = params.documentId || searchParams.get("documentId") || null;
  const { toast } = useToast();

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
  const [errorDocumentId, setErrorDocumentId] = useState<string | null>(null);

  // Request-new-link flow
  const [reissueOpen, setReissueOpen] = useState(false);
  const [reissueEmail, setReissueEmail] = useState("");
  const [reissueSending, setReissueSending] = useState(false);
  const [reissueSent, setReissueSent] = useState(false);

  // Signature state
  const [signatureMethod, setSignatureMethod] = useState<SignatureMethod>("type");
  const [typedName, setTypedName] = useState("");
  const [selectedFont, setSelectedFont] = useState(SIGNATURE_FONTS[0]);
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  useEffect(() => { if (routeToken) loadSigningData(routeToken, routeDocumentId); }, [routeToken, routeDocumentId]);

  const loadSigningData = async (signerToken: string, expectedDocumentId: string | null) => {
    try {
      const { data, error } = await supabase.functions.invoke("signing-session", {
        body: { token: signerToken, documentId: expectedDocumentId ?? undefined },
      });
      if (error) {
        // Try to extract structured error body from the edge function.
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
    window.location.hostname.includes("lovable.app") &&
    window.location.hostname.includes("preview")
      ? "https://bishopaisign.lovable.app"
      : window.location.origin;

  const requestNewLink = async () => {
    if (!reissueEmail.trim()) {
      toast({ title: "Enter your email", variant: "destructive" });
      return;
    }
    const targetDocId = errorDocumentId || routeDocumentId;
    if (!targetDocId) {
      toast({
        title: "Can't reissue this link",
        description: "This link is missing document information. Ask the sender to resend it.",
        variant: "destructive",
      });
      return;
    }
    setReissueSending(true);
    try {
      const { error } = await supabase.functions.invoke("request-new-link", {
        body: { documentId: targetDocId, email: reissueEmail.trim(), origin: publicOrigin() },
      });
      if (error) throw error;
      setReissueSent(true);
      toast({
        title: "Check your inbox",
        description: "If your email is on this document, a fresh signing link is on its way.",
      });
    } catch (err: any) {
      toast({ title: "Couldn't send new link", description: err.message, variant: "destructive" });
    } finally {
      setReissueSending(false);
    }
  };

  // Drawing (mouse + touch)
  const getCanvasPos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  };
  const beginStroke = (clientX: number, clientY: number) => {
    const ctx = canvasRef.current?.getContext("2d"); if (!ctx) return;
    const p = getCanvasPos(clientX, clientY);
    drawingRef.current = true;
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const moveStroke = (clientX: number, clientY: number) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d"); if (!ctx) return;
    const p = getCanvasPos(clientX, clientY);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.stroke();
  };
  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (canvasRef.current) setSignatureImage(canvasRef.current.toDataURL("image/png"));
  };
  const clearCanvas = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureImage(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setSignatureImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const getSignatureData = () => {
    if (signatureMethod === "type") return { method: "type", name: typedName, font: selectedFont };
    return { method: signatureMethod, image: signatureImage };
  };

  const handleSubmit = async () => {
    if (!signer || !doc) return;
    if (signatureMethod === "type" && !typedName.trim()) {
      toast({ title: "Please type your name", variant: "destructive" }); return;
    }
    if ((signatureMethod === "draw" || signatureMethod === "upload") && !signatureImage) {
      toast({ title: "Please provide your signature", variant: "destructive" }); return;
    }
    // Required field validation
    const missing = fields.filter(f => f.required && (f.type === "text" || f.type === "date") && !fieldValues[f.id]);
    if (missing.length > 0) {
      toast({ title: "Missing fields", description: `Please fill ${missing.length} required field(s).`, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-signature", {
        body: { token, fieldValues, signatureData: getSignatureData(),
          typedName: signatureMethod === "type" ? typedName : undefined },
      });
      if (error || !data?.success) throw new Error((error as any)?.message || data?.error || "Failed to submit");
      setState("signed");
      toast({ title: "Document signed!", description: "Thank you for signing." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const handleDecline = async () => {
    if (!declineReason.trim()) {
      toast({ title: "Please provide a reason", variant: "destructive" }); return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("decline-signature", {
        body: { token, reason: declineReason },
      });
      if (error || !data?.success) throw new Error((error as any)?.message || "Failed to decline");
      setDeclineOpen(false);
      setState("declined");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
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
              ? `This document must be signed by ${waitingFor} first. You'll be notified when it's your turn.`
              : "This document must be signed in order. You'll be notified when it's your turn."}
          </p>
        </div>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground mb-2">Link expired</h1>
          <p className="text-muted-foreground">This signing link has expired. Please request a new one from the sender.</p>
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

  if (state === "invalid" || !signer || !doc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="font-heading text-2xl font-bold text-foreground mb-2">Invalid Link</h1>
          <p className="text-muted-foreground">This signing link is invalid or has been used.</p>
        </div>
      </div>
    );
  }

  const renderOverlayField = (field: any, pageWidthPx: number, pageHeightPx: number) => {
    const left = (field.x_pct ?? 0) * pageWidthPx;
    const top = (field.y_pct ?? 0) * pageHeightPx;
    const width = (field.w_pct ?? 0.2) * pageWidthPx;
    const height = (field.h_pct ?? 0.05) * pageHeightPx;
    const filled = field.type === "signature"
      ? !!(signatureMethod === "type" ? typedName : signatureImage)
      : !!fieldValues[field.id];
    return (
      <div key={field.id}
        className={`absolute rounded border-2 flex items-center justify-center text-[10px] font-medium ${
          filled ? "border-primary bg-primary/10 text-primary" : "border-accent bg-accent/20 text-accent-foreground animate-pulse"
        }`}
        style={{ left, top, width, height }}>
        {field.type === "signature" ? "Sign here" : (field.label || field.type)}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 h-14 flex items-center justify-between sticky top-0 z-10">
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
          <p className="text-sm text-muted-foreground">Signing as <strong>{signer.name || signer.email}</strong></p>
        </div>

        {pdfUrl && (
          <div className="mb-8 space-y-4">
            <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)}>
              {Array.from({ length: numPages }, (_, i) => {
                const pageNum = i + 1;
                const dims = pageDims[pageNum];
                return (
                  <div key={pageNum} className="relative rounded-xl overflow-hidden border border-border mx-auto" style={{ width: PAGE_WIDTH }}>
                    <Page pageNumber={pageNum} width={PAGE_WIDTH}
                      onLoadSuccess={(p) => setPageDims(prev => ({ ...prev, [pageNum]: { w: p.width, h: p.height } }))} />
                    {dims && fields.filter(f => f.page_number === pageNum).map(f => renderOverlayField(f, dims.w, dims.h))}
                  </div>
                );
              })}
            </Document>
          </div>
        )}

        {fields.filter((f) => f.type === "text" || f.type === "date").length > 0 && (
          <div className="mb-8 space-y-4">
            <h2 className="font-heading text-lg font-semibold text-foreground">Complete these fields</h2>
            {fields.filter((f) => f.type === "text" || f.type === "date").map((field) => (
              <div key={field.id}>
                <label className="text-sm font-medium text-foreground mb-1 block">
                  {field.label || field.type} {field.required && <span className="text-destructive">*</span>}
                </label>
                <Input type={field.type === "date" ? "date" : "text"} value={fieldValues[field.id] || ""}
                  onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="font-heading text-lg font-semibold text-foreground mb-4">Your Signature</h2>
          <div className="flex gap-2 mb-6">
            {[
              { method: "type" as const, icon: Type, label: "Type" },
              { method: "draw" as const, icon: PenTool, label: "Draw" },
              { method: "upload" as const, icon: UploadIcon, label: "Upload" },
            ].map(({ method, icon: Icon, label }) => (
              <button key={method} onClick={() => setSignatureMethod(method)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  signatureMethod === method ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}>
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {signatureMethod === "type" && (
            <div>
              <Input placeholder="Type your full name" value={typedName}
                onChange={(e) => setTypedName(e.target.value)} className="mb-4" />
              {typedName && (
                <div className="border border-border rounded-lg p-6 bg-background">
                  <p className="text-3xl text-foreground" style={{ fontFamily: selectedFont }}>{typedName}</p>
                </div>
              )}
              <div className="flex gap-2 mt-3 flex-wrap">
                {SIGNATURE_FONTS.map((font) => (
                  <button key={font} onClick={() => setSelectedFont(font)}
                    className={`px-3 py-1.5 border rounded-md text-sm transition-colors ${
                      selectedFont === font ? "border-primary bg-primary/5" : "border-border"
                    }`} style={{ fontFamily: font }}>Signature</button>
                ))}
              </div>
            </div>
          )}

          {signatureMethod === "draw" && (
            <div>
              <canvas ref={canvasRef} width={600} height={180}
                className="border border-border rounded-lg bg-background w-full cursor-crosshair touch-none"
                onMouseDown={(e) => beginStroke(e.clientX, e.clientY)}
                onMouseMove={(e) => moveStroke(e.clientX, e.clientY)}
                onMouseUp={endStroke} onMouseLeave={endStroke}
                onTouchStart={(e) => { const t = e.touches[0]; beginStroke(t.clientX, t.clientY); }}
                onTouchMove={(e) => { e.preventDefault(); const t = e.touches[0]; moveStroke(t.clientX, t.clientY); }}
                onTouchEnd={endStroke} />
              <Button variant="ghost" size="sm" onClick={clearCanvas} className="mt-2">Clear</Button>
            </div>
          )}

          {signatureMethod === "upload" && (
            <div>
              {signatureImage ? (
                <div className="border border-border rounded-lg p-4 bg-background">
                  <img src={signatureImage} alt="Signature" className="max-h-24 mx-auto" />
                  <Button variant="ghost" size="sm" onClick={() => setSignatureImage(null)} className="mt-2">Remove</Button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg p-8 cursor-pointer hover:border-primary/50">
                  <UploadIcon className="w-8 h-8 text-muted-foreground mb-2" />
                  <span className="text-sm text-muted-foreground">Upload signature image (PNG, JPG)</span>
                  <input type="file" accept=".png,.jpg,.jpeg" className="hidden" onChange={handleImageUpload} />
                </label>
              )}
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-col sm:flex-row justify-between gap-3">
          <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="lg" className="gap-2">
                <XCircle className="w-4 h-4" /> Decline to Sign
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Decline to sign</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">The sender will be notified with your reason.</p>
              <Textarea placeholder="Reason for declining..." value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDeclineOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDecline}>Decline</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button size="lg" onClick={handleSubmit} disabled={submitting} className="gap-2 px-8">
            <FileSignature className="w-4 h-4" /> {submitting ? "Signing..." : "Sign Document"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-6">
          By clicking "Sign Document", you agree that your electronic signature is the legal equivalent
          of your handwritten signature, in accordance with the ESIGN Act and UETA.
        </p>
      </div>
    </div>
  );
};

export default SignDocument;

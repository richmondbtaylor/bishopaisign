import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { FileSignature, CheckCircle2, PenTool, Type, Upload as UploadIcon } from "lucide-react";

type SignatureMethod = "type" | "draw" | "upload";

const SIGNATURE_FONTS = [
  "'Dancing Script', cursive",
  "'Great Vibes', cursive",
  "'Pacifico', cursive",
];

const SignDocument = () => {
  const { token } = useParams();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [signer, setSigner] = useState<any>(null);
  const [document, setDocument] = useState<any>(null);
  const [fields, setFields] = useState<any[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Signature state
  const [signatureMethod, setSignatureMethod] = useState<SignatureMethod>("type");
  const [typedName, setTypedName] = useState("");
  const [selectedFont, setSelectedFont] = useState(SIGNATURE_FONTS[0]);
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [numPages, setNumPages] = useState<number>(0);

  useEffect(() => {
    if (token) loadSigningData(token);
  }, [token]);

  const loadSigningData = async (signerToken: string) => {
    try {
      // Fetch signer by token — using anon access (no auth needed)
      // We need a public endpoint for this. For now, use service role via edge function
      // Simplified: fetch via anon key with RLS bypass for token-based access
      const { data: signerData, error: signerErr } = await supabase
        .from("document_signers")
        .select("*, documents(*)")
        .eq("token", signerToken)
        .single();

      if (signerErr || !signerData) {
        toast({ title: "Invalid link", description: "This signing link is invalid or expired.", variant: "destructive" });
        setLoading(false);
        return;
      }

      setSigner(signerData);
      setDocument(signerData.documents);

      if (signerData.status === "signed") {
        setCompleted(true);
        setLoading(false);
        return;
      }

      // Mark as viewed
      await supabase
        .from("document_signers")
        .update({ status: "viewed", viewed_at: new Date().toISOString() })
        .eq("id", signerData.id);

      // Load fields
      const { data: fieldsData } = await supabase
        .from("document_fields")
        .select("*")
        .eq("document_id", signerData.document_id);

      setFields(fieldsData || []);

      // Get PDF URL
      if (signerData.documents?.file_path) {
        const { data: signed } = await supabase.storage
          .from("documents")
          .createSignedUrl(signerData.documents.file_path, 3600);
        if (signed?.signedUrl) setPdfUrl(signed.signedUrl);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  // Drawing canvas handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current) {
      setSignatureImage(canvasRef.current.toDataURL());
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
    if (signatureMethod === "type") {
      return { method: "type", name: typedName, font: selectedFont };
    }
    return { method: signatureMethod, image: signatureImage };
  };

  const handleSubmit = async () => {
    if (!signer || !document) return;

    // Validate signature
    if (signatureMethod === "type" && !typedName.trim()) {
      toast({ title: "Please type your name", variant: "destructive" });
      return;
    }
    if ((signatureMethod === "draw" || signatureMethod === "upload") && !signatureImage) {
      toast({ title: "Please provide your signature", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      // Save signature data to signature fields
      const sigFields = fields.filter((f) => f.type === "signature");
      for (const field of sigFields) {
        await supabase.from("document_fields").update({
          value: signatureMethod === "type" ? typedName : "signed",
          signature_data: getSignatureData(),
        }).eq("id", field.id);
      }

      // Save other field values
      for (const [fieldId, value] of Object.entries(fieldValues)) {
        await supabase.from("document_fields").update({ value }).eq("id", fieldId);
      }

      // Mark signer as signed
      await supabase.from("document_signers").update({
        status: "signed",
        signed_at: new Date().toISOString(),
        ip_address: "client",
        user_agent: navigator.userAgent,
      }).eq("id", signer.id);

      // Check if all signers signed — update document status
      const { data: allSigners } = await supabase
        .from("document_signers")
        .select("status")
        .eq("document_id", document.id);

      const allSigned = allSigners?.every((s) => s.status === "signed");
      if (allSigned) {
        await supabase.from("documents").update({
          status: "completed",
          completed_at: new Date().toISOString(),
        }).eq("id", document.id);
      } else {
        await supabase.from("documents").update({ status: "partially_signed" }).eq("id", document.id);
      }

      setCompleted(true);
      toast({ title: "Document signed!", description: "Thank you for signing." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (completed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-foreground mb-2">Document Signed</h1>
          <p className="text-muted-foreground">
            Your signature has been recorded. You'll receive a copy of the completed document via email.
          </p>
        </div>
      </div>
    );
  }

  if (!signer || !document) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="font-heading text-2xl font-bold text-foreground mb-2">Invalid Link</h1>
          <p className="text-muted-foreground">This signing link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <FileSignature className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-heading text-lg font-bold text-foreground">SignVault</span>
        </div>
        <span className="text-sm text-muted-foreground">{document.title}</span>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="font-heading text-xl font-bold text-foreground mb-1">
            Please review and sign
          </h1>
          <p className="text-sm text-muted-foreground">
            Signing as <strong>{signer.name || signer.email}</strong>
          </p>
        </div>

        {/* PDF Preview */}
        {pdfUrl && (
          <div className="mb-8 rounded-xl overflow-hidden border border-border">
            <iframe src={pdfUrl} className="w-full" style={{ height: 600 }} title="Document" />
          </div>
        )}

        {/* Form Fields */}
        {fields.filter((f) => f.type === "text" || f.type === "date").length > 0 && (
          <div className="mb-8 space-y-4">
            <h2 className="font-heading text-lg font-semibold text-foreground">Complete these fields</h2>
            {fields
              .filter((f) => f.type === "text" || f.type === "date")
              .map((field) => (
                <div key={field.id}>
                  <label className="text-sm font-medium text-foreground mb-1 block">
                    {field.label || field.type}{" "}
                    {field.required && <span className="text-destructive">*</span>}
                  </label>
                  <Input
                    type={field.type === "date" ? "date" : "text"}
                    placeholder={field.placeholder || ""}
                    value={fieldValues[field.id] || ""}
                    onChange={(e) =>
                      setFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                    }
                  />
                </div>
              ))}
          </div>
        )}

        {/* Signature */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="font-heading text-lg font-semibold text-foreground mb-4">Your Signature</h2>

          {/* Method tabs */}
          <div className="flex gap-2 mb-6">
            {[
              { method: "type" as const, icon: Type, label: "Type" },
              { method: "draw" as const, icon: PenTool, label: "Draw" },
              { method: "upload" as const, icon: UploadIcon, label: "Upload" },
            ].map(({ method, icon: Icon, label }) => (
              <button
                key={method}
                onClick={() => setSignatureMethod(method)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  signatureMethod === method
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>

          {/* Type signature */}
          {signatureMethod === "type" && (
            <div>
              <Input
                placeholder="Type your full name"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                className="mb-4"
              />
              {typedName && (
                <div className="border border-border rounded-lg p-6 bg-background">
                  <p className="text-3xl text-foreground" style={{ fontFamily: selectedFont }}>
                    {typedName}
                  </p>
                </div>
              )}
              <div className="flex gap-2 mt-3">
                {SIGNATURE_FONTS.map((font) => (
                  <button
                    key={font}
                    onClick={() => setSelectedFont(font)}
                    className={`px-3 py-1.5 border rounded-md text-sm transition-colors ${
                      selectedFont === font ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    style={{ fontFamily: font }}
                  >
                    Signature
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Draw signature */}
          {signatureMethod === "draw" && (
            <div>
              <canvas
                ref={canvasRef}
                width={500}
                height={150}
                className="border border-border rounded-lg bg-background w-full cursor-crosshair"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
              />
              <Button variant="ghost" size="sm" onClick={clearCanvas} className="mt-2">
                Clear
              </Button>
            </div>
          )}

          {/* Upload signature */}
          {signatureMethod === "upload" && (
            <div>
              {signatureImage ? (
                <div className="border border-border rounded-lg p-4 bg-background">
                  <img src={signatureImage} alt="Signature" className="max-h-24 mx-auto" />
                  <Button variant="ghost" size="sm" onClick={() => setSignatureImage(null)} className="mt-2">
                    Remove
                  </Button>
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

        {/* Submit */}
        <div className="mt-8 flex justify-end">
          <Button size="lg" onClick={handleSubmit} disabled={submitting} className="gap-2 px-8">
            <FileSignature className="w-4 h-4" />
            {submitting ? "Signing..." : "Sign Document"}
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

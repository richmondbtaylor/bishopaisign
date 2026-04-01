import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  FileSignature, ArrowLeft, Upload, Send, Plus, Trash2, GripVertical,
  Type, CheckSquare, Calendar, PenTool, AtSign, ChevronDown, Users,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FieldType = "signature" | "text" | "checkbox" | "date" | "initials" | "dropdown";
type PlacedField = {
  id: string;
  type: FieldType;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  signerIndex: number;
  label: string;
  required: boolean;
};

type Signer = {
  email: string;
  name: string;
  order: number;
};

const fieldTypeConfig: Record<FieldType, { icon: any; label: string; defaultW: number; defaultH: number }> = {
  signature: { icon: PenTool, label: "Signature", defaultW: 200, defaultH: 60 },
  text: { icon: Type, label: "Text", defaultW: 180, defaultH: 32 },
  checkbox: { icon: CheckSquare, label: "Checkbox", defaultW: 24, defaultH: 24 },
  date: { icon: Calendar, label: "Date", defaultW: 140, defaultH: 32 },
  initials: { icon: AtSign, label: "Initials", defaultW: 80, defaultH: 40 },
  dropdown: { icon: ChevronDown, label: "Dropdown", defaultW: 160, defaultH: 32 },
};

const SIGNER_COLORS = ["#0d9668", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

const DocumentEditor = () => {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [title, setTitle] = useState("Untitled Document");
  const [file, setFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [signers, setSigners] = useState<Signer[]>([{ email: "", name: "", order: 1 }]);
  const [signingMode, setSigning] = useState<"sequential" | "parallel">("parallel");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragType, setDragType] = useState<FieldType | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(id === "new" ? null : id || null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Load existing document
  useEffect(() => {
    if (!isNew && id) {
      loadDocument(id);
    }
  }, [id]);

  const loadDocument = async (docId: string) => {
    const { data: doc } = await supabase.from("documents").select("*").eq("id", docId).single();
    if (doc) {
      setTitle(doc.title);
      setSigning(doc.signing_mode as "sequential" | "parallel");
      setDocumentId(doc.id);
      if (doc.file_path) {
        const { data } = supabase.storage.from("documents").getPublicUrl(doc.file_path);
        // For private buckets we need createSignedUrl
        const { data: signed } = await supabase.storage.from("documents").createSignedUrl(doc.file_path, 3600);
        if (signed?.signedUrl) setPdfUrl(signed.signedUrl);
      }
    }
    // Load signers
    const { data: dbSigners } = await supabase.from("document_signers").select("*").eq("document_id", docId).order("signing_order");
    if (dbSigners?.length) {
      setSigners(dbSigners.map(s => ({ email: s.email, name: s.name || "", order: s.signing_order })));
    }
    // Load fields
    const { data: dbFields } = await supabase.from("document_fields").select("*").eq("document_id", docId);
    if (dbFields?.length) {
      setFields(dbFields.map(f => ({
        id: f.id,
        type: f.type as FieldType,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        page: f.page_number,
        signerIndex: 0,
        label: f.label || "",
        required: f.required,
      })));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || f.type !== "application/pdf") {
      toast({ title: "Invalid file", description: "Please upload a PDF file.", variant: "destructive" });
      return;
    }
    setFile(f);
    setTitle(f.name.replace(".pdf", ""));
    const url = URL.createObjectURL(f);
    setPdfUrl(url);
  };

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!dragType || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const config = fieldTypeConfig[dragType];
      const newField: PlacedField = {
        id: crypto.randomUUID(),
        type: dragType,
        x: e.clientX - rect.left - config.defaultW / 2,
        y: e.clientY - rect.top - config.defaultH / 2,
        width: config.defaultW,
        height: config.defaultH,
        page: 1,
        signerIndex: 0,
        label: config.label,
        required: true,
      };
      setFields((prev) => [...prev, newField]);
      setDragType(null);
    },
    [dragType]
  );

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedField === id) setSelectedField(null);
  };

  const addSigner = () => {
    setSigners((prev) => [...prev, { email: "", name: "", order: prev.length + 1 }]);
  };

  const removeSigner = (index: number) => {
    setSigners((prev) => prev.filter((_, i) => i !== index));
  };

  const updateSigner = (index: number, key: keyof Signer, value: string | number) => {
    setSigners((prev) => prev.map((s, i) => (i === index ? { ...s, [key]: value } : s)));
  };

  const handleSave = async () => {
    if (!user) return;
    setUploading(true);
    try {
      let filePath = null;
      // Upload file if new
      if (file) {
        const ext = file.name.split(".").pop();
        filePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("documents").upload(filePath, file);
        if (uploadErr) throw uploadErr;
      }

      if (documentId) {
        // Update existing
        await supabase.from("documents").update({
          title,
          signing_mode: signingMode,
          ...(filePath ? { file_path: filePath } : {}),
        }).eq("id", documentId);
      } else {
        // Create new
        const { data: doc, error: docErr } = await supabase.from("documents").insert({
          title,
          sender_id: user.id,
          signing_mode: signingMode,
          file_path: filePath,
          status: "draft",
        }).select().single();
        if (docErr) throw docErr;
        setDocumentId(doc.id);
      }

      toast({ title: "Saved", description: "Document saved as draft." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (!documentId || !user) {
      // Save first
      await handleSave();
      if (!documentId) return;
    }

    const validSigners = signers.filter((s) => s.email.trim());
    if (validSigners.length === 0) {
      toast({ title: "Add signers", description: "Add at least one signer email.", variant: "destructive" });
      return;
    }

    setSending(true);
    try {
      // Save the current doc id (may have been set by handleSave)
      const docId = documentId!;

      // Upsert signers
      // First delete existing signers
      await supabase.from("document_signers").delete().eq("document_id", docId);
      const { error: signerErr } = await supabase.from("document_signers").insert(
        validSigners.map((s, i) => ({
          document_id: docId,
          email: s.email,
          name: s.name || null,
          signing_order: s.order || i + 1,
          status: "sent",
        }))
      );
      if (signerErr) throw signerErr;

      // Save fields
      await supabase.from("document_fields").delete().eq("document_id", docId);
      if (fields.length > 0) {
        const { error: fieldErr } = await supabase.from("document_fields").insert(
          fields.map((f) => ({
            document_id: docId,
            type: f.type,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            page_number: f.page,
            label: f.label,
            required: f.required,
          }))
        );
        if (fieldErr) throw fieldErr;
      }

      // Update status to sent
      await supabase.from("documents").update({ status: "sent" }).eq("id", docId);

      // Log audit
      await supabase.from("audit_logs").insert({
        document_id: docId,
        action: "document_sent",
        actor_id: user.id,
        actor_email: user.email,
      });

      toast({ title: "Document sent!", description: `Sent to ${validSigners.length} signer(s).` });
      navigate("/dashboard");
    } catch (err: any) {
      toast({ title: "Error sending", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-64 h-8 text-sm font-medium border-transparent hover:border-border focus:border-border"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSave} disabled={uploading}>
            {uploading ? "Saving..." : "Save Draft"}
          </Button>
          <Button size="sm" onClick={handleSend} disabled={sending} className="gap-2">
            <Send className="w-3.5 h-3.5" /> {sending ? "Sending..." : "Send for Signature"}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Fields & Signers */}
        <aside className="w-72 border-r border-border bg-card overflow-y-auto shrink-0">
          {/* Fields toolbar */}
          <div className="p-4 border-b border-border">
            <h3 className="font-heading text-sm font-semibold text-foreground mb-3">Fields</h3>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(fieldTypeConfig) as [FieldType, typeof fieldTypeConfig[FieldType]][]).map(
                ([type, config]) => {
                  const Icon = config.icon;
                  return (
                    <div
                      key={type}
                      draggable
                      onDragStart={() => setDragType(type)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted cursor-grab text-xs font-medium text-foreground transition-colors"
                    >
                      <Icon className="w-3.5 h-3.5 text-primary" />
                      {config.label}
                    </div>
                  );
                }
              )}
            </div>
          </div>

          {/* Signers */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-heading text-sm font-semibold text-foreground">Signers</h3>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={addSigner}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="space-y-3">
              {signers.map((signer, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: SIGNER_COLORS[i % SIGNER_COLORS.length] }}
                    />
                    <span className="text-xs font-medium text-muted-foreground">Signer {i + 1}</span>
                    {signers.length > 1 && (
                      <button onClick={() => removeSigner(i)} className="ml-auto text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <Input
                    placeholder="Name"
                    value={signer.name}
                    onChange={(e) => updateSigner(i, "name", e.target.value)}
                    className="h-7 text-xs"
                  />
                  <Input
                    placeholder="email@example.com"
                    type="email"
                    value={signer.email}
                    onChange={(e) => updateSigner(i, "email", e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Signing mode */}
          <div className="p-4">
            <Label className="text-xs font-semibold text-foreground mb-2 block">Signing Order</Label>
            <Select value={signingMode} onValueChange={(v) => setSigning(v as any)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="parallel">Everyone signs at once</SelectItem>
                <SelectItem value="sequential">Sign in order</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </aside>

        {/* Main Canvas */}
        <main className="flex-1 overflow-auto bg-muted/30 p-8">
          {!pdfUrl ? (
            <div className="max-w-lg mx-auto mt-20">
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-12 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors">
                <Upload className="w-10 h-10 text-muted-foreground mb-4" />
                <span className="font-heading text-lg font-semibold text-foreground mb-1">Upload a PDF</span>
                <span className="text-sm text-muted-foreground">Drag and drop or click to browse</span>
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
          ) : (
            <div
              ref={canvasRef}
              className="relative bg-card rounded-xl shadow-elevated mx-auto"
              style={{ width: 800, minHeight: 1035 }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleCanvasDrop}
            >
              {/* PDF embed */}
              <iframe
                src={pdfUrl + "#toolbar=0"}
                className="w-full rounded-xl pointer-events-none"
                style={{ height: 1035 }}
                title="PDF Preview"
              />

              {/* Placed fields overlay */}
              {fields.map((field) => {
                const config = fieldTypeConfig[field.type];
                const Icon = config.icon;
                const color = SIGNER_COLORS[field.signerIndex % SIGNER_COLORS.length];
                return (
                  <div
                    key={field.id}
                    className={`absolute border-2 rounded flex items-center justify-center cursor-pointer transition-shadow ${
                      selectedField === field.id ? "shadow-lg ring-2 ring-primary" : ""
                    }`}
                    style={{
                      left: field.x,
                      top: field.y,
                      width: field.width,
                      height: field.height,
                      borderColor: color,
                      backgroundColor: color + "15",
                    }}
                    onClick={() => setSelectedField(field.id)}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color }} />
                    <span className="ml-1 text-[10px] font-medium" style={{ color }}>
                      {field.label}
                    </span>
                    {selectedField === field.id && (
                      <button
                        className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeField(field.id);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default DocumentEditor;

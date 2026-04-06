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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  FileSignature, ArrowLeft, Upload, Send, Plus, Trash2, GripVertical,
  Type, CheckSquare, Calendar, PenTool, AtSign, ChevronDown, Users, Save,
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
  dbId?: string;
};

type ResizeHandle = "nw" | "ne" | "sw" | "se";

const MIN_FIELD_SIZE = 20;

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
  const [activeSignerIndex, setActiveSignerIndex] = useState(0);
  const [draggingFieldId, setDraggingFieldId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizingFieldId, setResizingFieldId] = useState<string | null>(null);
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null);
  const [resizeStartData, setResizeStartData] = useState<{ mouseX: number; mouseY: number; x: number; y: number; w: number; h: number } | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
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
        const { data: signed } = await supabase.storage.from("documents").createSignedUrl(doc.file_path, 3600);
        if (signed?.signedUrl) setPdfUrl(signed.signedUrl);
      }
    }
    // Load signers
    const { data: dbSigners } = await supabase.from("document_signers").select("*").eq("document_id", docId).order("signing_order");
    if (dbSigners?.length) {
      setSigners(dbSigners.map(s => ({ email: s.email, name: s.name || "", order: s.signing_order, dbId: s.id })));
    }
    // Load fields
    const { data: dbFields } = await supabase.from("document_fields").select("*").eq("document_id", docId);
    if (dbFields?.length) {
      // Map signer_id back to signerIndex
      const { data: signerList } = await supabase.from("document_signers").select("id").eq("document_id", docId).order("signing_order");
      const signerIdToIndex: Record<string, number> = {};
      signerList?.forEach((s, i) => { signerIdToIndex[s.id] = i; });

      setFields(dbFields.map(f => ({
        id: f.id,
        type: f.type as FieldType,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        page: f.page_number,
        signerIndex: f.signer_id ? (signerIdToIndex[f.signer_id] ?? 0) : 0,
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
        signerIndex: activeSignerIndex,
        label: config.label,
        required: true,
      };
      setFields((prev) => [...prev, newField]);
      setDragType(null);
    },
    [dragType, activeSignerIndex]
  );

  // Field repositioning via mouse drag
  const handleFieldMouseDown = (e: React.MouseEvent, fieldId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const field = fields.find(f => f.id === fieldId);
    if (!field || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setDraggingFieldId(fieldId);
    setIsInteracting(true);
    setDragOffset({
      x: e.clientX - rect.left - field.x,
      y: e.clientY - rect.top - field.y,
    });
    setSelectedField(fieldId);
  };

  // Resize handle mousedown
  const handleResizeMouseDown = (e: React.MouseEvent, fieldId: string, handle: ResizeHandle) => {
    e.stopPropagation();
    e.preventDefault();
    const field = fields.find(f => f.id === fieldId);
    if (!field) return;
    setResizingFieldId(fieldId);
    setResizeHandle(handle);
    setIsInteracting(true);
    setResizeStartData({
      mouseX: e.clientX,
      mouseY: e.clientY,
      x: field.x,
      y: field.y,
      w: field.width,
      h: field.height,
    });
    setSelectedField(fieldId);
  };

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (draggingFieldId && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      const newX = Math.max(0, e.clientX - rect.left - dragOffset.x);
      const newY = Math.max(0, e.clientY - rect.top - dragOffset.y);
      setFields(prev => prev.map(f =>
        f.id === draggingFieldId ? { ...f, x: newX, y: newY } : f
      ));
    } else if (resizingFieldId && resizeStartData && resizeHandle) {
      const dx = e.clientX - resizeStartData.mouseX;
      const dy = e.clientY - resizeStartData.mouseY;
      setFields(prev => prev.map(f => {
        if (f.id !== resizingFieldId) return f;
        let { x, y, w, h } = resizeStartData;
        switch (resizeHandle) {
          case "se": w += dx; h += dy; break;
          case "sw": x += dx; w -= dx; h += dy; break;
          case "ne": w += dx; y += dy; h -= dy; break;
          case "nw": x += dx; w -= dx; y += dy; h -= dy; break;
        }
        w = Math.max(MIN_FIELD_SIZE, w);
        h = Math.max(MIN_FIELD_SIZE, h);
        return { ...f, x, y, width: w, height: h };
      }));
    }
  }, [draggingFieldId, dragOffset, resizingFieldId, resizeStartData, resizeHandle]);

  const handleCanvasMouseUp = useCallback(() => {
    setDraggingFieldId(null);
    setResizingFieldId(null);
    setResizeHandle(null);
    setResizeStartData(null);
    setIsInteracting(false);
  }, []);

  // Keyboard delete
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedField) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        removeField(selectedField);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedField]);

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedField === id) setSelectedField(null);
  };

  const updateField = (id: string, updates: Partial<PlacedField>) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };
  const addSigner = () => {
    setSigners((prev) => [...prev, { email: "", name: "", order: prev.length + 1 }]);
  };

  const removeSigner = (index: number) => {
    // Remove fields assigned to this signer and adjust remaining indices
    setFields(prev => prev
      .filter(f => f.signerIndex !== index)
      .map(f => f.signerIndex > index ? { ...f, signerIndex: f.signerIndex - 1 } : f)
    );
    setSigners((prev) => prev.filter((_, i) => i !== index));
    if (activeSignerIndex >= index && activeSignerIndex > 0) {
      setActiveSignerIndex(activeSignerIndex - 1);
    }
  };

  const updateSigner = (index: number, key: keyof Signer, value: string | number) => {
    setSigners((prev) => prev.map((s, i) => (i === index ? { ...s, [key]: value } : s)));
  };

  const handleSave = async () => {
    if (!user) return;
    setUploading(true);
    try {
      let filePath = null;
      if (file) {
        const ext = file.name.split(".").pop();
        filePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("documents").upload(filePath, file);
        if (uploadErr) throw uploadErr;
      }

      if (documentId) {
        await supabase.from("documents").update({
          title,
          signing_mode: signingMode,
          ...(filePath ? { file_path: filePath } : {}),
        }).eq("id", documentId);
      } else {
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
    if (!user) return;

    // If no documentId, save first
    if (!documentId) {
      await handleSave();
    }

    const validSigners = signers.filter((s) => s.email.trim());
    if (validSigners.length === 0) {
      toast({ title: "Add signers", description: "Add at least one signer email.", variant: "destructive" });
      return;
    }

    setSending(true);
    try {
      const docId = documentId!;

      // Delete existing signers & re-insert
      await supabase.from("document_signers").delete().eq("document_id", docId);
      const { data: insertedSigners, error: signerErr } = await supabase.from("document_signers").insert(
        validSigners.map((s, i) => ({
          document_id: docId,
          email: s.email,
          name: s.name || null,
          signing_order: s.order || i + 1,
          status: "sent",
        }))
      ).select();
      if (signerErr) throw signerErr;

      // Build signer index → signer DB id map
      const signerIdMap: Record<number, string> = {};
      if (insertedSigners) {
        // Map by order of insertion (matches validSigners order)
        insertedSigners.forEach((s, i) => {
          signerIdMap[i] = s.id;
        });
      }

      // Save fields with correct signer_id
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
            signer_id: signerIdMap[f.signerIndex] || null,
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

      // Invoke edge function to send emails
      try {
        await supabase.functions.invoke("send-sign-request", {
          body: { documentId: docId, origin: window.location.origin },
        });
      } catch (emailErr) {
        console.error("Email sending failed:", emailErr);
        // Don't block the flow if email fails
      }

      toast({ title: "Document sent!", description: `Sent to ${validSigners.length} signer(s).` });
      navigate("/dashboard");
    } catch (err: any) {
      toast({ title: "Error sending", description: err.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const activeSignerFields = fields.filter(f => f.signerIndex === activeSignerIndex);
  const otherFields = fields.filter(f => f.signerIndex !== activeSignerIndex);

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
          {/* Active Signer Selector */}
          <div className="p-4 border-b border-border">
            <h3 className="font-heading text-sm font-semibold text-foreground mb-3">Active Signer</h3>
            <div className="space-y-1">
              {signers.map((signer, i) => {
                const color = SIGNER_COLORS[i % SIGNER_COLORS.length];
                const fieldCount = fields.filter(f => f.signerIndex === i).length;
                return (
                  <button
                    key={i}
                    onClick={() => setActiveSignerIndex(i)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      activeSignerIndex === i
                        ? "ring-2 ring-offset-1 bg-muted"
                        : "hover:bg-muted/50"
                    }`}
                    style={{
                      borderLeft: `3px solid ${color}`,
                      ...(activeSignerIndex === i ? { ringColor: color } : {}),
                    }}
                  >
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="truncate text-foreground">
                      {signer.name || signer.email || `Signer ${i + 1}`}
                    </span>
                    <span className="ml-auto text-muted-foreground">{fieldCount}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Drop fields onto the PDF to assign them to the active signer.
            </p>
          </div>

          {/* Fields toolbar */}
          <div className="p-4 border-b border-border">
            <h3 className="font-heading text-sm font-semibold text-foreground mb-3">Fields</h3>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(fieldTypeConfig) as [FieldType, typeof fieldTypeConfig[FieldType]][]).map(
                ([type, config]) => {
                  const Icon = config.icon;
                  const color = SIGNER_COLORS[activeSignerIndex % SIGNER_COLORS.length];
                  return (
                    <div
                      key={type}
                      draggable
                      onDragStart={() => setDragType(type)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted cursor-grab text-xs font-medium text-foreground transition-colors"
                      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color }} />
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
          <div className="p-4 border-b border-border">
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

          {/* Field Properties Panel */}
          {selectedField && (() => {
            const sf = fields.find(f => f.id === selectedField);
            if (!sf) return null;
            const color = SIGNER_COLORS[sf.signerIndex % SIGNER_COLORS.length];
            return (
              <div className="p-4 border-b border-border">
                <h3 className="font-heading text-sm font-semibold text-foreground mb-3">Field Properties</h3>
                <div className="space-y-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Label</Label>
                    <Input
                      value={sf.label}
                      onChange={(e) => updateField(sf.id, { label: e.target.value })}
                      className="h-7 text-xs mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Width</Label>
                      <Input
                        type="number"
                        value={sf.width}
                        min={MIN_FIELD_SIZE}
                        onChange={(e) => updateField(sf.id, { width: Math.max(MIN_FIELD_SIZE, Number(e.target.value)) })}
                        className="h-7 text-xs mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Height</Label>
                      <Input
                        type="number"
                        value={sf.height}
                        min={MIN_FIELD_SIZE}
                        onChange={(e) => updateField(sf.id, { height: Math.max(MIN_FIELD_SIZE, Number(e.target.value)) })}
                        className="h-7 text-xs mt-1"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="field-required"
                      checked={sf.required}
                      onCheckedChange={(checked) => updateField(sf.id, { required: !!checked })}
                    />
                    <Label htmlFor="field-required" className="text-xs text-foreground cursor-pointer">Required</Label>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                    Signer {sf.signerIndex + 1} · {fieldTypeConfig[sf.type].label}
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full h-7 text-xs gap-1"
                    onClick={() => removeField(sf.id)}
                  >
                    <Trash2 className="w-3 h-3" /> Delete Field
                  </Button>
                </div>
              </div>
            );
          })()}
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
              style={{ width: 800, minHeight: 1035, userSelect: isInteracting ? "none" : "auto" }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleCanvasDrop}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              onClick={() => { if (!draggingFieldId && !resizingFieldId) setSelectedField(null); }}
            >
              {/* PDF rendered via react-pdf */}
              <Document
                file={pdfUrl}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                className="w-full"
              >
                {Array.from({ length: numPages }, (_, i) => (
                  <Page key={i} pageNumber={i + 1} width={800} />
                ))}
              </Document>

              {/* Other signers' fields (dimmed) */}
              {otherFields.map((field) => {
                const config = fieldTypeConfig[field.type];
                const Icon = config.icon;
                const color = SIGNER_COLORS[field.signerIndex % SIGNER_COLORS.length];
                return (
                  <div
                    key={field.id}
                    className="absolute border-2 rounded flex items-center justify-center opacity-40 cursor-pointer transition-shadow"
                    style={{
                      left: field.x,
                      top: field.y,
                      width: field.width,
                      height: field.height,
                      borderColor: color,
                      backgroundColor: color + "10",
                    }}
                    onClick={() => {
                      setActiveSignerIndex(field.signerIndex);
                      setSelectedField(field.id);
                    }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color }} />
                    <span className="ml-1 text-[10px] font-medium" style={{ color }}>
                      {field.label}
                    </span>
                  </div>
                );
              })}

              {/* Active signer fields (full opacity, draggable, resizable) */}
              {activeSignerFields.map((field) => {
                const config = fieldTypeConfig[field.type];
                const Icon = config.icon;
                const color = SIGNER_COLORS[field.signerIndex % SIGNER_COLORS.length];
                const isSelected = selectedField === field.id;
                const isDragging = draggingFieldId === field.id;
                return (
                  <div
                    key={field.id}
                    className={`absolute border-2 rounded flex items-center justify-center transition-shadow select-none ${
                      isSelected ? "shadow-lg ring-2 ring-primary" : ""
                    } ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
                    style={{
                      left: field.x,
                      top: field.y,
                      width: field.width,
                      height: field.height,
                      borderColor: color,
                      backgroundColor: color + "20",
                      zIndex: isSelected ? 20 : 10,
                    }}
                    onMouseDown={(e) => handleFieldMouseDown(e, field.id)}
                    onClick={(e) => { e.stopPropagation(); setSelectedField(field.id); }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color }} />
                    <span className="ml-1 text-[10px] font-medium" style={{ color }}>
                      {field.label}
                    </span>

                    {/* Floating toolbar above field */}
                    {isSelected && (
                      <div
                        className="absolute flex items-center gap-1 bg-card border border-border rounded-md shadow-md px-1.5 py-0.5"
                        style={{ top: -32, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap" }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <span className="text-[9px] text-muted-foreground">
                          {Math.round(field.width)}×{Math.round(field.height)}
                        </span>
                        <button
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-destructive/10 text-destructive"
                          onClick={(e) => { e.stopPropagation(); removeField(field.id); }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {/* Resize handles on selected field */}
                    {isSelected && (["nw", "ne", "sw", "se"] as ResizeHandle[]).map(handle => {
                      const posStyle: React.CSSProperties = {
                        position: "absolute",
                        width: 8,
                        height: 8,
                        backgroundColor: color,
                        border: "1px solid white",
                        borderRadius: 2,
                        zIndex: 30,
                        ...(handle.includes("n") ? { top: -4 } : { bottom: -4 }),
                        ...(handle.includes("w") ? { left: -4 } : { right: -4 }),
                        cursor: handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize",
                      };
                      return (
                        <div
                          key={handle}
                          style={posStyle}
                          onMouseDown={(e) => handleResizeMouseDown(e, field.id, handle)}
                        />
                      );
                    })}
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

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
  ArrowLeft, Upload, Send, Plus, Trash2,
  Type, Calendar, PenTool,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FieldType = "signature" | "text" | "date";
type PlacedField = {
  id: string;
  type: FieldType;
  // Page-relative percent coords (0..1)
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
  page: number;
  signerIndex: number;
  label: string;
  required: boolean;
};

type Signer = { email: string; name: string; order: number; dbId?: string };
type ResizeHandle = "nw" | "ne" | "sw" | "se";

const PAGE_WIDTH = 800;
const MIN_PCT = 0.02;

const fieldTypeConfig: Record<FieldType, { icon: any; label: string; defaultWPct: number; defaultHPct: number }> = {
  signature: { icon: PenTool, label: "Signature", defaultWPct: 0.25, defaultHPct: 0.06 },
  text: { icon: Type, label: "Text", defaultWPct: 0.22, defaultHPct: 0.035 },
  date: { icon: Calendar, label: "Date", defaultWPct: 0.17, defaultHPct: 0.035 },
};

const SIGNER_COLORS = ["#1B2A4A", "#C9A227", "#3b82f6", "#0d9668", "#8b5cf6"];

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
  const [signingMode, setSigningMode] = useState<"sequential" | "parallel">("sequential");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragType, setDragType] = useState<FieldType | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageDims, setPageDims] = useState<Record<number, { w: number; h: number }>>({});
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(id === "new" ? null : id || null);
  const [activeSignerIndex, setActiveSignerIndex] = useState(0);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Drag/resize refs
  const interactionRef = useRef<{
    mode: "move" | "resize";
    fieldId: string;
    handle?: ResizeHandle;
    startPct: { x: number; y: number; w: number; h: number };
    startMouse: { x: number; y: number };
    page: number;
  } | null>(null);

  useEffect(() => {
    if (!isNew && id) loadDocument(id);
  }, [id]);

  const loadDocument = async (docId: string) => {
    const { data: doc } = await supabase.from("documents").select("*").eq("id", docId).single();
    if (doc) {
      setTitle(doc.title);
      setSigningMode((doc.signing_mode as "sequential" | "parallel") || "sequential");
      setDocumentId(doc.id);
      if (doc.expires_at) setExpiresAt(new Date(doc.expires_at).toISOString().slice(0, 10));
      if (doc.file_path) {
        const { data: signed } = await supabase.storage.from("documents").createSignedUrl(doc.file_path, 3600);
        if (signed?.signedUrl) setPdfUrl(signed.signedUrl);
      }
    }
    const { data: dbSigners } = await supabase.from("document_signers").select("*").eq("document_id", docId).order("signing_order");
    if (dbSigners?.length) {
      setSigners(dbSigners.map(s => ({ email: s.email, name: s.name || "", order: s.signing_order, dbId: s.id })));
    }
    const { data: dbFields } = await supabase.from("document_fields").select("*").eq("document_id", docId);
    if (dbFields?.length) {
      const { data: signerList } = await supabase.from("document_signers").select("id").eq("document_id", docId).order("signing_order");
      const signerIdToIndex: Record<string, number> = {};
      signerList?.forEach((s, i) => { signerIdToIndex[s.id] = i; });
      setFields(dbFields.map((f: any) => ({
        id: f.id,
        type: (f.type as FieldType),
        x_pct: f.x_pct ?? 0.1,
        y_pct: f.y_pct ?? 0.1,
        w_pct: f.w_pct ?? 0.22,
        h_pct: f.h_pct ?? 0.05,
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
    // Validate PDF parses
    try {
      const buf = await f.arrayBuffer();
      await pdfjs.getDocument({ data: buf }).promise;
    } catch {
      toast({ title: "Corrupt PDF", description: "This file could not be parsed as a PDF.", variant: "destructive" });
      return;
    }
    setFile(f);
    setTitle(f.name.replace(/\.pdf$/i, ""));
    setPdfUrl(URL.createObjectURL(f));
  };

  const onPageDrop = (e: React.DragEvent, pageNum: number) => {
    e.preventDefault();
    if (!dragType) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cfg = fieldTypeConfig[dragType];
    const xPct = (e.clientX - rect.left) / rect.width - cfg.defaultWPct / 2;
    const yPct = (e.clientY - rect.top) / rect.height - cfg.defaultHPct / 2;
    const newField: PlacedField = {
      id: crypto.randomUUID(),
      type: dragType,
      x_pct: Math.max(0, Math.min(1 - cfg.defaultWPct, xPct)),
      y_pct: Math.max(0, Math.min(1 - cfg.defaultHPct, yPct)),
      w_pct: cfg.defaultWPct,
      h_pct: cfg.defaultHPct,
      page: pageNum,
      signerIndex: activeSignerIndex,
      label: cfg.label,
      required: true,
    };
    setFields(prev => [...prev, newField]);
    setSelectedField(newField.id);
    setDragType(null);
  };

  const startInteraction = (
    e: React.MouseEvent,
    field: PlacedField,
    mode: "move" | "resize",
    handle?: ResizeHandle
  ) => {
    e.stopPropagation();
    e.preventDefault();
    interactionRef.current = {
      mode, fieldId: field.id, handle,
      startPct: { x: field.x_pct, y: field.y_pct, w: field.w_pct, h: field.h_pct },
      startMouse: { x: e.clientX, y: e.clientY },
      page: field.page,
    };
    setSelectedField(field.id);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const it = interactionRef.current;
      if (!it) return;
      const rect = pageRefs.current[it.page]?.getBoundingClientRect();
      if (!rect) return;
      const dxPct = (e.clientX - it.startMouse.x) / rect.width;
      const dyPct = (e.clientY - it.startMouse.y) / rect.height;
      setFields(prev => prev.map(f => {
        if (f.id !== it.fieldId) return f;
        if (it.mode === "move") {
          return {
            ...f,
            x_pct: Math.max(0, Math.min(1 - f.w_pct, it.startPct.x + dxPct)),
            y_pct: Math.max(0, Math.min(1 - f.h_pct, it.startPct.y + dyPct)),
          };
        }
        let { x, y, w, h } = it.startPct;
        switch (it.handle) {
          case "se": w += dxPct; h += dyPct; break;
          case "sw": x += dxPct; w -= dxPct; h += dyPct; break;
          case "ne": w += dxPct; y += dyPct; h -= dyPct; break;
          case "nw": x += dxPct; w -= dxPct; y += dyPct; h -= dyPct; break;
        }
        w = Math.max(MIN_PCT, w); h = Math.max(MIN_PCT, h);
        x = Math.max(0, Math.min(1 - w, x));
        y = Math.max(0, Math.min(1 - h, y));
        return { ...f, x_pct: x, y_pct: y, w_pct: w, h_pct: h };
      }));
    };
    const onUp = () => { interactionRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedField) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        setFields(prev => prev.filter(f => f.id !== selectedField));
        setSelectedField(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedField]);

  const addSigner = () => setSigners(prev => [...prev, { email: "", name: "", order: prev.length + 1 }]);
  const removeSigner = (index: number) => {
    setFields(prev => prev
      .filter(f => f.signerIndex !== index)
      .map(f => f.signerIndex > index ? { ...f, signerIndex: f.signerIndex - 1 } : f));
    setSigners(prev => prev.filter((_, i) => i !== index));
    if (activeSignerIndex >= index && activeSignerIndex > 0) setActiveSignerIndex(activeSignerIndex - 1);
  };
  const updateSigner = (i: number, k: keyof Signer, v: string | number) =>
    setSigners(prev => prev.map((s, idx) => idx === i ? { ...s, [k]: v } : s));

  const persist = async (): Promise<string | null> => {
    if (!user) return null;
    let filePath: string | null = null;
    if (file) {
      const ext = file.name.split(".").pop();
      filePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(filePath, file);
      if (upErr) throw upErr;
    }
    const expiresIso = expiresAt ? new Date(expiresAt + "T23:59:59Z").toISOString() : null;
    let docId = documentId;
    if (docId) {
      await supabase.from("documents").update({
        title, signing_mode: signingMode, expires_at: expiresIso,
        ...(filePath ? { file_path: filePath } : {}),
      }).eq("id", docId);
    } else {
      const { data: doc, error } = await supabase.from("documents").insert({
        title, sender_id: user.id, signing_mode: signingMode,
        file_path: filePath, status: "draft", expires_at: expiresIso,
      }).select().single();
      if (error) throw error;
      docId = doc.id;
      setDocumentId(docId);
    }
    return docId;
  };

  const handleSave = async () => {
    setUploading(true);
    try {
      await persist();
      toast({ title: "Saved", description: "Document saved as draft." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setUploading(false); }
  };

  const handleSend = async () => {
    const validSigners = signers.filter(s => s.email.trim());
    if (validSigners.length === 0) {
      toast({ title: "Add signers", description: "Add at least one signer email.", variant: "destructive" });
      return;
    }
    if (fields.length === 0) {
      toast({ title: "Place at least one field", description: "Drag a signature or date onto the PDF.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const docId = await persist();
      if (!docId) throw new Error("Could not save document");

      await supabase.from("document_signers").delete().eq("document_id", docId);
      const { data: insertedSigners, error: signerErr } = await supabase.from("document_signers").insert(
        validSigners.map((s, i) => ({
          document_id: docId, email: s.email, name: s.name || null,
          signing_order: i + 1, status: "sent",
        }))
      ).select();
      if (signerErr) throw signerErr;

      const signerIdMap: Record<number, string> = {};
      insertedSigners?.forEach((s, i) => { signerIdMap[i] = s.id; });

      await supabase.from("document_fields").delete().eq("document_id", docId);
      if (fields.length > 0) {
        const { error: fErr } = await supabase.from("document_fields").insert(
          fields.map(f => ({
            document_id: docId,
            type: f.type,
            x: 0, y: 0, width: 0, height: 0,
            x_pct: f.x_pct, y_pct: f.y_pct, w_pct: f.w_pct, h_pct: f.h_pct,
            page_number: f.page,
            label: f.label, required: f.required,
            signer_id: signerIdMap[f.signerIndex] || null,
          }))
        );
        if (fErr) throw fErr;
      }

      await supabase.from("documents").update({ status: "sent" }).eq("id", docId);
      await supabase.from("audit_logs").insert({
        document_id: docId, action: "document_sent",
        actor_id: user!.id, actor_email: user!.email,
      });

      await supabase.functions.invoke("send-sign-request", {
        body: { documentId: docId, origin: window.location.origin },
      });

      toast({ title: "Document sent!", description: `Sent to ${validSigners.length} signer(s).` });
      navigate(`/documents/${docId}`);
    } catch (err: any) {
      toast({ title: "Error sending", description: err.message, variant: "destructive" });
    } finally { setSending(false); }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-64 h-8 text-sm font-medium border-transparent hover:border-border focus:border-border" />
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
        <aside className="w-72 border-r border-border bg-card overflow-y-auto shrink-0">
          <div className="p-4 border-b border-border">
            <h3 className="font-heading text-sm font-semibold text-foreground mb-3">Active Signer</h3>
            <div className="space-y-1">
              {signers.map((signer, i) => {
                const color = SIGNER_COLORS[i % SIGNER_COLORS.length];
                const fieldCount = fields.filter(f => f.signerIndex === i).length;
                return (
                  <button key={i} onClick={() => setActiveSignerIndex(i)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      activeSignerIndex === i ? "bg-muted ring-2 ring-primary/20" : "hover:bg-muted/50"
                    }`}
                    style={{ borderLeft: `3px solid ${color}` }}>
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span className="truncate text-foreground">{signer.name || signer.email || `Signer ${i + 1}`}</span>
                    <span className="ml-auto text-muted-foreground">{fieldCount}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Drop fields onto the PDF to assign them to the active signer.</p>
          </div>

          <div className="p-4 border-b border-border">
            <h3 className="font-heading text-sm font-semibold text-foreground mb-3">Fields</h3>
            <div className="grid grid-cols-1 gap-2">
              {(Object.entries(fieldTypeConfig) as [FieldType, typeof fieldTypeConfig[FieldType]][]).map(([type, cfg]) => {
                const Icon = cfg.icon;
                const color = SIGNER_COLORS[activeSignerIndex % SIGNER_COLORS.length];
                return (
                  <div key={type} draggable
                    onDragStart={() => setDragType(type)}
                    onDragEnd={() => setDragType(null)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background hover:bg-muted cursor-grab text-xs font-medium text-foreground transition-colors"
                    style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
                    <Icon className="w-3.5 h-3.5" style={{ color }} />
                    {cfg.label}
                  </div>
                );
              })}
            </div>
          </div>

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
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: SIGNER_COLORS[i % SIGNER_COLORS.length] }} />
                    <span className="text-xs font-medium text-muted-foreground">Signer {i + 1}</span>
                    {signers.length > 1 && (
                      <button onClick={() => removeSigner(i)} className="ml-auto text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <Input placeholder="Name" value={signer.name}
                    onChange={(e) => updateSigner(i, "name", e.target.value)} className="h-7 text-xs" />
                  <Input placeholder="email@example.com" type="email" value={signer.email}
                    onChange={(e) => updateSigner(i, "email", e.target.value)} className="h-7 text-xs" />
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 border-b border-border space-y-3">
            <div>
              <Label className="text-xs font-semibold text-foreground mb-2 block">Signing Order</Label>
              <Select value={signingMode} onValueChange={(v) => setSigningMode(v as any)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequential">Sign in order</SelectItem>
                  <SelectItem value="parallel">Everyone signs at once</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold text-foreground mb-2 block">Expires on</Label>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
        </aside>

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
            <div className="mx-auto space-y-4" style={{ width: PAGE_WIDTH }}>
              <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)}>
                {Array.from({ length: numPages }, (_, i) => {
                  const pageNum = i + 1;
                  const dims = pageDims[pageNum];
                  return (
                    <div key={pageNum}
                      ref={(el) => { pageRefs.current[pageNum] = el; }}
                      className="relative bg-card rounded-xl shadow-elevated overflow-hidden"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onPageDrop(e, pageNum)}
                      onClick={() => setSelectedField(null)}>
                      <Page pageNumber={pageNum} width={PAGE_WIDTH}
                        onLoadSuccess={(p) => setPageDims(prev => ({ ...prev, [pageNum]: { w: p.width, h: p.height } }))} />
                      {dims && fields.filter(f => f.page === pageNum).map(field => {
                        const active = field.signerIndex === activeSignerIndex;
                        const cfg = fieldTypeConfig[field.type];
                        const Icon = cfg.icon;
                        const color = SIGNER_COLORS[field.signerIndex % SIGNER_COLORS.length];
                        const isSelected = selectedField === field.id;
                        return (
                          <div key={field.id}
                            className={`absolute border-2 rounded flex items-center justify-center select-none transition-shadow ${
                              active ? "cursor-grab" : "cursor-pointer opacity-40"
                            } ${isSelected ? "ring-2 ring-primary shadow-lg" : ""}`}
                            style={{
                              left: `${field.x_pct * 100}%`,
                              top: `${field.y_pct * 100}%`,
                              width: `${field.w_pct * 100}%`,
                              height: `${field.h_pct * 100}%`,
                              borderColor: color,
                              backgroundColor: color + "20",
                              zIndex: isSelected ? 20 : 10,
                            }}
                            onMouseDown={(e) => active && startInteraction(e, field, "move")}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!active) setActiveSignerIndex(field.signerIndex);
                              setSelectedField(field.id);
                            }}>
                            <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
                            <span className="ml-1 text-[10px] font-medium truncate" style={{ color }}>{field.label}</span>
                            {isSelected && active && (["nw", "ne", "sw", "se"] as ResizeHandle[]).map(h => (
                              <div key={h}
                                style={{
                                  position: "absolute", width: 10, height: 10,
                                  backgroundColor: color, border: "1px solid white", borderRadius: 2, zIndex: 30,
                                  ...(h.includes("n") ? { top: -5 } : { bottom: -5 }),
                                  ...(h.includes("w") ? { left: -5 } : { right: -5 }),
                                  cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize",
                                }}
                                onMouseDown={(e) => startInteraction(e, field, "resize", h)} />
                            ))}
                          </div>
                        );
                      })}
                      <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded pointer-events-none">
                        Page {pageNum}
                      </div>
                    </div>
                  );
                })}
              </Document>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default DocumentEditor;

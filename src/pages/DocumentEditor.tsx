import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Upload, Send, Plus, Trash2,
  Type, Calendar, PenTool, ChevronUp, ChevronDown,
  PanelLeftClose, PanelLeftOpen, Feather, CheckSquare,
  FileText, Search, MoreVertical, Pencil, Sparkles, Loader2, X, Copy, CopyPlus, Wand2,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import DocumentAiSummary, { type DocumentSummary } from "@/components/DocumentAiSummary";

type FieldType = "signature" | "text" | "date" | "initials" | "checkbox";
type PlacedField = {
  id: string;
  type: FieldType;
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
type SavedPdf = { id: string; display_name: string; file_path: string; created_at: string };
type ResizeHandle = "nw" | "ne" | "sw" | "se";

const PAGE_WIDTH = 800;
const MIN_PCT = 0.02;

const fieldTypeConfig: Record<FieldType, { icon: any; label: string; defaultWPct: number; defaultHPct: number }> = {
  signature: { icon: PenTool, label: "Signature", defaultWPct: 0.25, defaultHPct: 0.06 },
  text: { icon: Type, label: "Text", defaultWPct: 0.22, defaultHPct: 0.035 },
  date: { icon: Calendar, label: "Date", defaultWPct: 0.17, defaultHPct: 0.035 },
  initials: { icon: Feather, label: "Initials", defaultWPct: 0.08, defaultHPct: 0.05 },
  checkbox: { icon: CheckSquare, label: "Checkbox", defaultWPct: 0.035, defaultHPct: 0.035 },
};


const SIGNER_COLORS = ["#1B2A4A", "#C9A227", "#3b82f6", "#0d9668", "#8b5cf6", "#e11d48", "#0891b2", "#ea580c"];

const DocumentEditor = () => {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [title, setTitle] = useState("Untitled Document");
  const [file, setFile] = useState<File | null>(null);
  const [reuseFilePath, setReuseFilePath] = useState<string | null>(null);
  const [savedPdfs, setSavedPdfs] = useState<SavedPdf[]>([]);
  const [savedPdfSearch, setSavedPdfSearch] = useState("");
  const [renamePdf, setRenamePdf] = useState<SavedPdf | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [hidePdf, setHidePdf] = useState<SavedPdf | null>(null);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageWidth, setPageWidth] = useState(PAGE_WIDTH);
  const [summary, setSummary] = useState<DocumentSummary | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [contacts, setContacts] = useState<{ name: string | null; email: string }[]>([]);
  const duplicateRef = useRef<((id: string) => void) | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const mainRef = useRef<HTMLElement | null>(null);
  const isMobile = useIsMobile();

  const interactionRef = useRef<{
    mode: "move" | "resize";
    fieldId: string;
    handle?: ResizeHandle;
    startPct: { x: number; y: number; w: number; h: number };
    startPointer: { x: number; y: number };
    page: number;
  } | null>(null);

  useEffect(() => {
    if (isMobile) setSidebarCollapsed(true);
  }, [isMobile]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const updateWidth = () => setPageWidth(Math.min(PAGE_WIDTH, Math.max(280, main.clientWidth - (isMobile ? 16 : 64))));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(main);
    return () => observer.disconnect();
  }, [isMobile, pdfUrl]);

  useEffect(() => {
    if (!isNew && id) loadDocument(id);
  }, [id]);

  useEffect(() => {
    if (!user) return;
    supabase.from("contacts").select("name, email").order("last_used_at", { ascending: false }).limit(500)
      .then(({ data }) => setContacts(data || []));
  }, [user]);

  useEffect(() => {
    if (!isNew || !user) return;
    (async () => {
      const { data } = await supabase.from("saved_pdfs")
        .select("id, display_name, file_path, created_at")
        .eq("hidden", false).order("updated_at", { ascending: false }).limit(100);
      setSavedPdfs(data || []);
    })();
  }, [isNew, user]);

  const pickSavedPdf = async (p: SavedPdf) => {
    const { data, error } = await supabase.storage.from("documents").createSignedUrl(p.file_path, 3600);
    if (error || !data?.signedUrl) {
      toast({ title: "Could not open PDF", description: error?.message, variant: "destructive" });
      return;
    }
    setFile(null);
    setReuseFilePath(p.file_path);
    setTitle(p.display_name);
    setPdfUrl(data.signedUrl);
  };

  const saveRename = async () => {
    if (!renamePdf || !renameValue.trim()) return;
    const displayName = renameValue.trim();
    const { error } = await supabase.from("saved_pdfs").update({ display_name: displayName }).eq("id", renamePdf.id);
    if (error) {
      toast({ title: "Rename failed", description: error.message, variant: "destructive" });
      return;
    }
    setSavedPdfs(prev => prev.map(pdf => pdf.id === renamePdf.id ? { ...pdf, display_name: displayName } : pdf));
    setRenamePdf(null);
  };

  const confirmHidePdf = async () => {
    if (!hidePdf) return;
    const { error } = await supabase.from("saved_pdfs").update({ hidden: true }).eq("id", hidePdf.id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setSavedPdfs(prev => prev.filter(pdf => pdf.id !== hidePdf.id));
    setHidePdf(null);
    toast({ title: "Removed from saved PDFs", description: "Existing documents and downloads are unchanged." });
  };

  const loadDocument = async (docId: string) => {
    const [{ data: doc }, { data: existingSummary }] = await Promise.all([
      supabase.from("documents").select("*").eq("id", docId).single(),
      supabase.from("document_ai_summaries").select("overview, clauses, deadlines, obligations").eq("document_id", docId).maybeSingle(),
    ]);
    if (existingSummary?.overview) setSummary(existingSummary as unknown as DocumentSummary);
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
    try {
      const buf = await f.arrayBuffer();
      await pdfjs.getDocument({ data: buf }).promise;
    } catch {
      toast({ title: "Corrupt PDF", description: "This file could not be parsed as a PDF.", variant: "destructive" });
      return;
    }
    setFile(f);
    setReuseFilePath(null);
    setTitle(f.name.replace(/\.pdf$/i, ""));
    setPdfUrl(URL.createObjectURL(f));
  };

  const placeField = (type: FieldType, pageNum: number, clientX: number, clientY: number, target: Element) => {
    const rect = target.getBoundingClientRect();
    const cfg = fieldTypeConfig[type];
    const xPct = (clientX - rect.left) / rect.width - cfg.defaultWPct / 2;
    const yPct = (clientY - rect.top) / rect.height - cfg.defaultHPct / 2;
    const newField: PlacedField = {
      id: crypto.randomUUID(), type,
      x_pct: Math.max(0, Math.min(1 - cfg.defaultWPct, xPct)),
      y_pct: Math.max(0, Math.min(1 - cfg.defaultHPct, yPct)),
      w_pct: cfg.defaultWPct, h_pct: cfg.defaultHPct, page: pageNum,
      signerIndex: activeSignerIndex, label: cfg.label, required: true,
    };
    setFields(prev => [...prev, newField]);
    setSelectedField(newField.id);
    setDragType(null);
  };

  const onPageDrop = (e: React.DragEvent, pageNum: number) => {
    e.preventDefault();
    if (!dragType) return;
    placeField(dragType, pageNum, e.clientX, e.clientY, e.currentTarget);
  };

  const startInteraction = (
    e: React.PointerEvent,
    field: PlacedField,
    mode: "move" | "resize",
    handle?: ResizeHandle
  ) => {
    e.stopPropagation();
    e.preventDefault();
    interactionRef.current = {
      mode, fieldId: field.id, handle,
      startPct: { x: field.x_pct, y: field.y_pct, w: field.w_pct, h: field.h_pct },
      startPointer: { x: e.clientX, y: e.clientY },
      page: field.page,
    };
    setSelectedField(field.id);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const it = interactionRef.current;
      if (!it) return;
      const rect = pageRefs.current[it.page]?.getBoundingClientRect();
      if (!rect) return;
      e.preventDefault();
      const dxPct = (e.clientX - it.startPointer.x) / rect.width;
      const dyPct = (e.clientY - it.startPointer.y) / rect.height;
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
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && selectedField) {
        e.preventDefault();
        duplicateRef.current?.(selectedField);
        return;
      }
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

  // Track current page based on scroll position so the minimap indicator stays
  // in sync with what the user is actually reading, even on long documents.
  useEffect(() => {
    const root = mainRef.current;
    if (!root || !numPages) return;

    let raf = 0;
    const compute = () => {
      raf = 0;
      const rootRect = root.getBoundingClientRect();
      // Anchor line ~35% down the viewport - matches where users read a page.
      const anchorY = rootRect.top + rootRect.height * 0.35;
      let bestPage = 1;
      let bestDist = Infinity;
      for (let i = 1; i <= numPages; i++) {
        const el = pageRefs.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        // Distance from anchor to the closest point of the page rect.
        const dist = r.top > anchorY ? r.top - anchorY
          : r.bottom < anchorY ? anchorY - r.bottom
          : 0;
        if (dist < bestDist) { bestDist = dist; bestPage = i; }
      }
      setCurrentPage(bestPage);
    };

    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Prime once after PDF pages mount so the indicator matches the initial view.
    const primer = window.setTimeout(compute, 50);
    return () => {
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(primer);
    };
  }, [numPages, pdfUrl, pageDims]);

  const scrollToPage = (n: number) => {
    const el = pageRefs.current[n];
    const root = mainRef.current;
    if (!el || !root) return;
    const target = el.offsetTop - 12;
    root.scrollTo({ top: target, behavior: "smooth" });
    setCurrentPage(n);
  };


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

  const moveSigner = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= signers.length) return;
    setSigners(prev => {
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
    setFields(prev => prev.map(f => {
      if (f.signerIndex === from) return { ...f, signerIndex: to };
      if (f.signerIndex === to) return { ...f, signerIndex: from };
      return f;
    }));
    if (activeSignerIndex === from) setActiveSignerIndex(to);
    else if (activeSignerIndex === to) setActiveSignerIndex(from);
  };

  const reassignField = (fieldId: string, signerIndex: number) => {
    setFields(prev => prev.map(f => f.id === fieldId ? { ...f, signerIndex } : f));
  };

  const duplicateField = (fieldId: string, signerIndex?: number) => {
    const src = fields.find(f => f.id === fieldId);
    if (!src) return;
    const copy: PlacedField = {
      ...src, id: crypto.randomUUID(),
      signerIndex: signerIndex ?? src.signerIndex,
      x_pct: Math.min(1 - src.w_pct, src.x_pct + 0.02),
      y_pct: Math.min(1 - src.h_pct, src.y_pct + 0.02),
    };
    setFields(prev => [...prev, copy]);
    setSelectedField(copy.id);
  };

  const duplicateToAllPages = (fieldId: string) => {
    const src = fields.find(f => f.id === fieldId);
    if (!src) return;
    const copies: PlacedField[] = [];
    for (let p = 1; p <= numPages; p++) {
      if (p !== src.page) copies.push({ ...src, id: crypto.randomUUID(), page: p });
    }
    setFields(prev => [...prev, ...copies]);
    toast({ title: "Duplicated", description: `Copied to ${copies.length} other page(s).` });
  };

  const persist = async (): Promise<string | null> => {
    if (!user) return null;
    let filePath: string | null = null;
    if (file) {
      const ext = file.name.split(".").pop();
      filePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(filePath, file);
      if (upErr) throw upErr;
      const { error: libraryError } = await supabase.from("saved_pdfs").upsert({
        owner_id: user.id, file_path: filePath, display_name: title, hidden: false,
      }, { onConflict: "owner_id,file_path" });
      if (libraryError) throw libraryError;
    } else if (reuseFilePath && !documentId) {
      filePath = reuseFilePath;
    }
    const expiresIso = expiresAt ? new Date(expiresAt + "T23:59:59Z").toISOString() : null;
    let docId = documentId;
    if (docId) {
      await supabase.from("documents").update({
        title, signing_mode: signingMode, expires_at: expiresIso,
        ...(filePath ? { file_path: filePath } : {}),
      }).eq("id", docId);
    } else {
      const { data: profile } = await supabase
        .from("profiles").select("organization_id").eq("user_id", user.id).maybeSingle();
      const { data: doc, error } = await supabase.from("documents").insert({
        title, sender_id: user.id, signing_mode: signingMode,
        file_path: filePath, status: "draft", expires_at: expiresIso,
        organization_id: profile?.organization_id ?? null,
      }).select().single();
      if (error) throw error;
      docId = doc.id;
      setDocumentId(docId);
    }
    return docId;
  };

  const analyzeDocument = async () => {
    setAnalyzing(true);
    try {
      const docId = await persist();
      if (!docId) throw new Error("Save the document before analyzing it.");
      const { data, error } = await supabase.functions.invoke("analyze-document", { body: { documentId: docId } });
      if (error) {
        const context = (error as any).context;
        let message = error.message;
        try { message = (await context?.json())?.error || message; } catch { /* response is not JSON */ }
        throw new Error(message);
      }
      setSummary(data?.summary || null);
      toast({ title: "Analysis complete", description: "Key clauses, deadlines, and obligations are ready." });
    } catch (error: any) {
      toast({ title: "Analysis failed", description: error.message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const autoPlaceFields = async () => {
    setDetecting(true);
    try {
      const docId = await persist();
      if (!docId) throw new Error("Save the document before auto-placing fields.");
      const { data, error } = await supabase.functions.invoke("detect-fields", { body: { documentId: docId } });
      if (error) {
        let message = error.message;
        try { message = (await (error as any).context?.json())?.error || message; } catch { /* not JSON */ }
        throw new Error(message);
      }
      const detected: Array<{ page: number; type: FieldType; label: string; signer_role: string | null; x_pct: number; y_pct: number; w_pct: number; h_pct: number }> = data?.fields || [];
      const valid = detected.filter(f => f.page >= 1 && (!numPages || f.page <= numPages));
      if (!valid.length) {
        toast({ title: "No blanks found", description: "Place fields manually by choosing a field type." });
        return;
      }
      // Map distinct signer roles to signers in order of appearance; add signers when needed.
      const roles: string[] = [];
      valid.forEach(f => { const r = f.signer_role?.trim(); if (r && !roles.includes(r.toLowerCase())) roles.push(r.toLowerCase()); });
      const useRoles = roles.length > 1;
      if (useRoles && roles.length > signers.length) {
        setSigners(prev => [...prev, ...Array.from({ length: roles.length - prev.length }, (_, k) => ({ email: "", name: "", order: prev.length + k + 1 }))]);
      }
      const newFields: PlacedField[] = valid.map(f => {
        const roleIdx = useRoles && f.signer_role ? roles.indexOf(f.signer_role.trim().toLowerCase()) : -1;
        return {
          id: crypto.randomUUID(), type: f.type, page: f.page,
          x_pct: f.x_pct, y_pct: f.y_pct, w_pct: f.w_pct, h_pct: f.h_pct,
          signerIndex: roleIdx >= 0 ? roleIdx : activeSignerIndex,
          label: f.label || fieldTypeConfig[f.type].label, required: f.type !== "checkbox",
        };
      });
      setFields(prev => [...prev, ...newFields]);
      toast({ title: `Placed ${newFields.length} field${newFields.length === 1 ? "" : "s"}`, description: "Review them, then move, resize, or delete as needed." });
    } catch (error: any) {
      toast({ title: "Auto-place failed", description: error.message, variant: "destructive" });
    } finally {
      setDetecting(false);
    }
  };

  const saveContacts = async (list: Signer[]) => {
    if (!user) return;
    const rows = list.filter(s => s.email.trim()).map(s => ({
      owner_id: user.id, email: s.email.trim().toLowerCase(),
      ...(s.name.trim() ? { name: s.name.trim() } : {}),
      last_used_at: new Date().toISOString(),
    }));
    if (!rows.length) return;
    const { error } = await supabase.from("contacts").upsert(rows, { onConflict: "owner_id,email" });
    if (error) console.warn("contact save failed", error);
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

      // Map original signer index (in `signers`) → inserted db signer id.
      // Only signers with valid emails were inserted, so build mapping from filtered order.
      const validIndexMap: number[] = [];
      signers.forEach((s, i) => { if (s.email.trim()) validIndexMap.push(i); });
      const signerIdMap: Record<number, string> = {};
      insertedSigners?.forEach((s, i) => {
        const originalIndex = validIndexMap[i];
        if (originalIndex !== undefined) signerIdMap[originalIndex] = s.id;
      });

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

      const publicOrigin = window.location.hostname === "bishopaisign.lovable.app"
        ? window.location.origin
        : "https://bishopaisign.lovable.app";
      const { error: sendErr } = await supabase.functions.invoke("send-sign-request", {
        body: { documentId: docId, origin: publicOrigin },
      });

      if (sendErr) {
        const ctx: any = (sendErr as any).context;
        if (ctx?.status === 402) {
          let body: any = {};
          try { body = await ctx.json(); } catch { /* ignore */ }
          // Roll status back so it doesn't get counted as sent.
          await supabase.from("documents").update({ status: "draft" }).eq("id", docId);
          toast({
            title: "Free plan limit reached",
            description: body?.message || "You've used all 5 free sends this month. Upgrade to Pro for unlimited sends.",
            variant: "destructive",
          });
          navigate("/billing");
          return;
        }
        throw sendErr;
      }

      await saveContacts(validSigners);
      toast({ title: "Document sent!", description: `Sent to ${validSigners.length} signer(s).` });
      navigate(`/documents/${docId}`);
    } catch (err: any) {
      toast({ title: "Error sending", description: err.message, variant: "destructive" });
    } finally { setSending(false); }
  };

  const activeColor = SIGNER_COLORS[activeSignerIndex % SIGNER_COLORS.length];

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <header className="border-b border-border bg-card px-2 sm:px-4 min-h-14 py-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1 sm:gap-3 min-w-0 flex-1">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setSidebarCollapsed(v => !v)} title={sidebarCollapsed ? "Expand panel" : "Collapse panel"}>
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </Button>
          <Input value={title} onChange={(e) => setTitle(e.target.value)}
            aria-label="Document title"
            className="min-w-0 w-full sm:w-64 h-8 text-sm font-medium border-transparent hover:border-border focus:border-border" />
        </div>
        <div className="flex items-center gap-2">
          <datalist id="saved-contact-emails">
            {contacts.map(c => <option key={c.email} value={c.email}>{c.name || ""}</option>)}
          </datalist>
          <datalist id="saved-contact-names">
            {contacts.filter(c => c.name).map(c => <option key={c.email} value={c.name!}>{c.email}</option>)}
          </datalist>
          {pdfUrl && (
            <Button variant="outline" size="sm" onClick={autoPlaceFields} disabled={detecting || uploading} className="gap-1.5" aria-label="Auto-place fields">
              {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">Auto-place fields</span>
            </Button>
          )}
          {pdfUrl && (
            <Button variant="outline" size="sm" onClick={analyzeDocument} disabled={analyzing || uploading} className="gap-1.5" aria-label="Analyze document with AI">
              {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{summary ? "Re-analyze" : "Analyze with AI"}</span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleSave} disabled={uploading} aria-label="Save draft">
            <span className="hidden sm:inline">{uploading ? "Saving..." : "Save Draft"}</span>
            <span className="sm:hidden">Save</span>
          </Button>
          <Button size="sm" onClick={handleSend} disabled={sending} className="gap-1.5" aria-label="Send for signature">
            <Send className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{sending ? "Sending..." : "Send for Signature"}</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {sidebarCollapsed ? (
          <aside className="hidden md:flex w-14 border-r border-border bg-card overflow-y-auto shrink-0 flex-col items-center py-3 gap-2">
            {signers.map((_, i) => {
              const color = SIGNER_COLORS[i % SIGNER_COLORS.length];
              return (
                <button key={i} onClick={() => setActiveSignerIndex(i)}
                  title={signers[i].name || signers[i].email || `Signer ${i + 1}`}
                  className={`w-8 h-8 rounded-full text-[10px] font-semibold text-white flex items-center justify-center ${
                    activeSignerIndex === i ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""
                  }`}
                  style={{ backgroundColor: color }}>
                  {i + 1}
                </button>
              );
            })}
            <div className="w-full border-t border-border my-2" />
            {(Object.entries(fieldTypeConfig) as [FieldType, typeof fieldTypeConfig[FieldType]][]).map(([type, cfg]) => {
              const Icon = cfg.icon;
              return (
                <div key={type} draggable
                  onDragStart={() => setDragType(type)}
                  onDragEnd={() => setDragType(null)}
                  title={cfg.label}
                  className="w-8 h-8 rounded border border-border bg-background hover:bg-muted cursor-grab flex items-center justify-center">
                  <Icon className="w-3.5 h-3.5" style={{ color: activeColor }} />
                </div>
              );
            })}
          </aside>
        ) : (
          <>
          <button type="button" aria-label="Close tools" onClick={() => setSidebarCollapsed(true)} className="fixed inset-0 top-14 z-40 bg-foreground/30 md:hidden" />
          <aside className="fixed inset-y-0 left-0 top-14 z-50 w-[min(20rem,88vw)] border-r border-border bg-card overflow-y-auto shadow-lg md:static md:w-72 md:shadow-none shrink-0">
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
              <p className="text-[10px] text-muted-foreground mt-2">Fields you drop onto the PDF are assigned to the active signer.</p>
            </div>

            <div className="p-4 border-b border-border">
              <h3 className="font-heading text-sm font-semibold text-foreground mb-3">Fields</h3>
              <div className="grid grid-cols-1 gap-2">
                {(Object.entries(fieldTypeConfig) as [FieldType, typeof fieldTypeConfig[FieldType]][]).map(([type, cfg]) => {
                  const Icon = cfg.icon;
                  return (
                    <button type="button" key={type} draggable
                      onDragStart={() => setDragType(type)}
                      onDragEnd={() => setDragType(null)}
                      onClick={() => {
                        setDragType(type);
                        if (isMobile) setSidebarCollapsed(true);
                      }}
                      aria-pressed={dragType === type}
                      className={`flex items-center gap-2 px-3 py-3 md:py-2 rounded-lg border bg-background hover:bg-muted cursor-grab text-xs font-medium text-foreground transition-colors ${dragType === type ? "border-primary ring-2 ring-primary/20" : "border-border"}`}
                      style={{ borderLeftColor: activeColor, borderLeftWidth: 3 }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: activeColor }} />
                      {cfg.label}
                    </button>
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
                  <div key={i} className="space-y-1.5 p-2 rounded-md bg-muted/30">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: SIGNER_COLORS[i % SIGNER_COLORS.length] }} />
                      <span className="text-xs font-medium text-muted-foreground">Signer {i + 1}</span>
                      <div className="ml-auto flex items-center gap-0.5">
                        {signingMode === "sequential" && signers.length > 1 && (
                          <>
                            <button onClick={() => moveSigner(i, -1)} disabled={i === 0}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Move up">
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button onClick={() => moveSigner(i, 1)} disabled={i === signers.length - 1}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Move down">
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </>
                        )}
                        {signers.length > 1 && (
                          <button onClick={() => removeSigner(i)} className="text-muted-foreground hover:text-destructive ml-1">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                    <Input placeholder="Name" value={signer.name} list="saved-contact-names"
                      onChange={(e) => {
                        const v = e.target.value;
                        const match = contacts.find(c => c.name && c.name === v);
                        if (match) setSigners(prev => prev.map((s, idx) => idx === i ? { ...s, name: v, email: match.email } : s));
                        else updateSigner(i, "name", v);
                      }} className="h-7 text-xs" />
                    <Input placeholder="email@example.com" type="email" value={signer.email} list="saved-contact-emails"
                      onChange={(e) => {
                        const v = e.target.value;
                        const match = contacts.find(c => c.email === v.trim().toLowerCase());
                        setSigners(prev => prev.map((s, idx) => idx === i ? { ...s, email: v, name: s.name || match?.name || "" } : s));
                      }} className="h-7 text-xs" />
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addSigner} className="w-full mt-3 gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Add signer
              </Button>
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
          </>
        )}

        <main ref={mainRef} className="flex-1 min-w-0 overflow-auto bg-muted/30 p-2 sm:p-4 lg:p-8">
          {!pdfUrl ? (
            <div className="max-w-lg mx-auto mt-20">
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-12 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors">
                <Upload className="w-10 h-10 text-muted-foreground mb-4" />
                <span className="font-heading text-lg font-semibold text-foreground mb-1">Upload a PDF</span>
                <span className="text-sm text-muted-foreground">Drag and drop or click to browse</span>
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
              </label>
              {savedPdfs.length > 0 && (
                <div className="mt-8">
                  <h3 className="font-heading text-sm font-semibold text-foreground mb-3">Or pick a saved PDF</h3>
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={savedPdfSearch} onChange={(event) => setSavedPdfSearch(event.target.value)} placeholder="Search saved PDFs" className="pl-9 pr-9" />
                    {savedPdfSearch && (
                      <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2" onClick={() => setSavedPdfSearch("")} aria-label="Clear search">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {savedPdfs.filter(pdf => pdf.display_name.toLowerCase().includes(savedPdfSearch.trim().toLowerCase())).map((p) => (
                      <div key={p.id} className="flex items-center border border-border rounded-lg bg-card hover:border-primary/50 hover:bg-primary/5 transition-colors">
                        <button type="button" onClick={() => pickSavedPdf(p)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left">
                          <FileText className="w-4 h-4 text-primary shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-foreground truncate">{p.display_name}</span>
                            <span className="block text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</span>
                          </span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="mr-1 shrink-0" aria-label={`Manage ${p.display_name}`}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => { setRenamePdf(p); setRenameValue(p.display_name); }}><Pencil className="mr-2 h-4 w-4" />Rename</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setHidePdf(p)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ))}
                  </div>
                  {savedPdfs.filter(pdf => pdf.display_name.toLowerCase().includes(savedPdfSearch.trim().toLowerCase())).length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">No saved PDFs match your search.</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto space-y-4" style={{ width: pageWidth }}>
              {summary && <DocumentAiSummary summary={summary} />}
              {dragType && (
                <div className="sticky top-2 z-30 mx-auto w-fit rounded-md border border-primary bg-card px-3 py-2 text-xs font-medium text-foreground shadow-lg">
                  Tap the PDF to place {fieldTypeConfig[dragType].label.toLowerCase()}
                </div>
              )}
              <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)}>
                {Array.from({ length: numPages }, (_, i) => {
                  const pageNum = i + 1;
                  const dims = pageDims[pageNum];
                  return (
                    <div key={pageNum}
                      ref={(el) => { pageRefs.current[pageNum] = el; }}
                      data-page={pageNum}
                      className="relative bg-card rounded-xl shadow-elevated overflow-hidden"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onPageDrop(e, pageNum)}
                      onClick={(e) => {
                        if (dragType) placeField(dragType, pageNum, e.clientX, e.clientY, e.currentTarget);
                        else setSelectedField(null);
                      }}>
                      <Page pageNumber={pageNum} width={pageWidth}
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
                              touchAction: active ? "none" : "manipulation",
                            }}
                            onPointerDown={(e) => active && startInteraction(e, field, "move")}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!active) setActiveSignerIndex(field.signerIndex);
                              setSelectedField(field.id);
                            }}>
                            <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
                            <span className="ml-1 text-[10px] font-medium truncate" style={{ color }}>{field.label}</span>
                            {isSelected && (
                              <div
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                                className="absolute -top-9 left-0 flex items-center gap-1 bg-card border border-border rounded-md shadow-lg px-1.5 py-1 z-40 whitespace-nowrap">
                                <span className="text-[10px] text-muted-foreground">Assigned:</span>
                                <select
                                  value={field.signerIndex}
                                  onChange={(e) => reassignField(field.id, Number(e.target.value))}
                                  className="text-[10px] bg-transparent border-none outline-none font-medium cursor-pointer"
                                  style={{ color }}>
                                  {signers.map((s, idx) => (
                                    <option key={idx} value={idx}>
                                      {s.name || s.email || `Signer ${idx + 1}`}
                                    </option>
                                  ))}
                                </select>
                                <button onClick={() => duplicateField(field.id)} className="text-muted-foreground hover:text-foreground ml-1 p-0.5" title="Duplicate field" aria-label="Duplicate field">
                                  <Copy className="w-3 h-3" />
                                </button>
                                {numPages > 1 && (
                                  <button onClick={() => duplicateToAllPages(field.id)} className="text-muted-foreground hover:text-foreground p-0.5" title="Duplicate to all pages" aria-label="Duplicate to all pages">
                                    <CopyPlus className="w-3 h-3" />
                                  </button>
                                )}
                                {signers.length > 1 && (
                                  <select value="" onChange={(e) => { if (e.target.value !== "") duplicateField(field.id, Number(e.target.value)); }}
                                    className="text-[10px] bg-transparent border-none outline-none cursor-pointer text-muted-foreground w-5" title="Duplicate for another signer" aria-label="Duplicate for another signer">
                                    <option value="">+</option>
                                    {signers.map((s, idx) => idx !== field.signerIndex && (
                                      <option key={idx} value={idx}>Copy for {s.name || s.email || `Signer ${idx + 1}`}</option>
                                    ))}
                                  </select>
                                )}
                                <button
                                  onClick={() => {
                                    setFields(prev => prev.filter(f => f.id !== field.id));
                                    setSelectedField(null);
                                  }}
                                  className="text-muted-foreground hover:text-destructive ml-1"
                                  title="Delete field">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                            {isSelected && active && (["nw", "ne", "sw", "se"] as ResizeHandle[]).map(h => (
                              <div key={h}
                                style={{
                                  position: "absolute", width: isMobile ? 22 : 10, height: isMobile ? 22 : 10,
                                  backgroundColor: color, border: "2px solid hsl(var(--card))", borderRadius: 4, zIndex: 30,
                                  ...(h.includes("n") ? { top: isMobile ? -11 : -5 } : { bottom: isMobile ? -11 : -5 }),
                                  ...(h.includes("w") ? { left: isMobile ? -11 : -5 } : { right: isMobile ? -11 : -5 }),
                                  cursor: h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize",
                                  touchAction: "none",
                                }}
                                onPointerDown={(e) => startInteraction(e, field, "resize", h)} />
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

        {pdfUrl && numPages > 1 && (
          <aside className="hidden md:flex w-16 border-l border-border bg-card overflow-y-auto shrink-0 py-3 flex-col items-center gap-2">
            <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">Pages</span>
            {Array.from({ length: numPages }, (_, i) => {
              const n = i + 1;
              const fieldCount = fields.filter(f => f.page === n).length;
              const isActive = currentPage === n;
              return (
                <button key={n} onClick={() => scrollToPage(n)}
                  className={`w-10 h-12 rounded border text-xs font-medium flex flex-col items-center justify-center gap-0.5 transition-all ${
                    isActive
                      ? "border-primary bg-primary/10 text-primary shadow-sm"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50"
                  }`}>
                  <span>{n}</span>
                  {fieldCount > 0 && (
                    <span className="text-[9px] bg-accent text-accent-foreground rounded-full px-1 leading-tight">{fieldCount}</span>
                  )}
                </button>
              );
            })}
          </aside>
        )}
      </div>
      <Dialog open={Boolean(renamePdf)} onOpenChange={(open) => !open && setRenamePdf(null)}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md">
          <DialogHeader><DialogTitle>Rename saved PDF</DialogTitle></DialogHeader>
          <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={160} autoFocus onKeyDown={(event) => event.key === "Enter" && saveRename()} />
          <DialogFooter><Button variant="outline" onClick={() => setRenamePdf(null)}>Cancel</Button><Button onClick={saveRename} disabled={!renameValue.trim()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(hidePdf)} onOpenChange={(open) => !open && setHidePdf(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)]">
          <AlertDialogHeader><AlertDialogTitle>Delete from saved PDFs?</AlertDialogTitle><AlertDialogDescription>This removes the PDF from quick select. Existing documents, signatures, and downloads remain available.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmHidePdf}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DocumentEditor;

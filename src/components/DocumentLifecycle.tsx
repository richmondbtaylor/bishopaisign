import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { downloadStoredPdf, safeFilename } from "@/lib/download";
import { Download, Loader2 } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type LifecycleDoc = {
  id: string;
  title: string;
  status: string;
  file_path?: string | null;
  completed_file_path?: string | null;
  voided_file_path?: string | null;
};

async function invokeOrThrow(name: string, body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try { message = (await (error as any).context?.json())?.error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  return data;
}

export function FinalCopyDialog({ doc, open, onOpenChange }: { doc: LifecycleDoc; open: boolean; onOpenChange: (o: boolean) => void }) {
  const options = [
    doc.voided_file_path ? { key: "void", label: "Voided copy", path: doc.voided_file_path } : null,
    doc.completed_file_path ? { key: "signed", label: doc.status === "voided" ? "Original signed copy" : "Signed copy", path: doc.completed_file_path } : null,
    !doc.completed_file_path && doc.file_path ? { key: "current", label: "In progress", path: doc.file_path } : null,
  ].filter(Boolean) as { key: string; label: string; path: string }[];
  const [choice, setChoice] = useState(options[0]?.key);
  const [url, setUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(600);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const current = options.find(o => o.key === choice) || options[0];

  useEffect(() => {
    if (!open || !current) return;
    setUrl(null);
    supabase.storage.from("documents").createSignedUrl(current.path, 600).then(({ data }) => setUrl(data?.signedUrl || null));
  }, [open, current?.path]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { if (boxRef.current) setWidth(Math.min(820, boxRef.current.clientWidth - 8)); }, 50);
    return () => clearTimeout(t);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[calc(100%-1rem)] h-[90vh] flex flex-col p-3 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
            <span className="truncate">{doc.title}</span>
            {current?.key === "current" && <Badge variant="secondary">In progress, not fully signed</Badge>}
            {current?.key === "void" && <Badge variant="destructive">Voided</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {options.length > 1 && options.map(o => (
            <Button key={o.key} size="sm" variant={o.key === current?.key ? "default" : "outline"} onClick={() => setChoice(o.key)}>{o.label}</Button>
          ))}
          {current && (
            <Button size="sm" variant="outline" className="gap-1.5 ml-auto"
              onClick={() => downloadStoredPdf(current.path, `${safeFilename(doc.title)}${current.key === "void" ? "-voided" : current.key === "signed" ? "-signed" : ""}.pdf`)}>
              <Download className="w-3.5 h-3.5" /> Download
            </Button>
          )}
        </div>
        <div ref={boxRef} className="flex-1 overflow-auto bg-muted/40 rounded-md p-1">
          {!current ? <p className="p-6 text-sm text-muted-foreground">No PDF is attached to this document.</p>
            : !url ? <div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            : (
              <Document file={url} onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                loading={<div className="p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>}>
                {Array.from({ length: numPages }, (_, i) => (
                  <Page key={i} pageNumber={i + 1} width={width} className="mx-auto mb-3 shadow" renderTextLayer={false} renderAnnotationLayer={false} />
                ))}
              </Document>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VoidDialog({ doc, open, onOpenChange, onDone }: { doc: LifecycleDoc; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await invokeOrThrow("void-document", { documentId: doc.id, reason });
      toast({ title: "Document voided", description: "Signers have been notified and their links no longer work." });
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast({ title: "Could not void", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100%-2rem)]">
        <AlertDialogHeader>
          <AlertDialogTitle>Void "{doc.title}"?</AlertDialogTitle>
          <AlertDialogDescription>
            The document will be marked as void. Signing links stop working, signers get an email, and
            {doc.status === "completed" ? " the signed PDF gets a VOID stamp. The original signed copy is kept." : " no one can sign it anymore."}
            {" "}This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="void-reason">Reason (shared with signers)</Label>
          <Textarea id="void-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Replaced by a revised agreement" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); run(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {busy ? "Voiding..." : "Void document"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteDocDialog({ doc, open, onOpenChange, onDone }: { doc: LifecycleDoc; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const active = doc.status === "sent" || doc.status === "partially_signed";
  const run = async () => {
    setBusy(true);
    try {
      await invokeOrThrow("delete-document", { documentId: doc.id });
      toast({ title: "Document deleted" });
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast({ title: "Could not delete", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100%-2rem)]">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{doc.title}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {active ? "It is still out for signature, so it will be voided first and signers will be told. " : ""}
            This permanently removes the document, its signed copies, fields, signers, and history. Only its name and date stay in your records. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); run(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {busy ? "Deleting..." : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const canVoid = (status: string) => ["sent", "partially_signed", "completed"].includes(status);

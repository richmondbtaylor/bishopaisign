import { supabase } from "@/integrations/supabase/client";

/** Save a Blob as a file. Works on desktop and mobile browsers. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function safeFilename(name: string) {
  return (name || "document").replace(/[^\w\s.-]+/g, "").trim().replace(/\s+/g, "-") || "document";
}

/** Download a file from the private documents bucket as a real file. */
export async function downloadStoredPdf(path: string, filename: string) {
  const { data, error } = await supabase.storage.from("documents").download(path);
  if (error || !data) throw new Error(error?.message || "Could not download file");
  saveBlob(new Blob([data], { type: "application/pdf" }), filename);
}

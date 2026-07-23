// Client-side mirror of supabase/functions/_shared/signature-fonts.ts sizing.
// Keep these in sync so the DocumentView / SignDocument overlays match the
// flattened output produced by finalize-document.
export function signatureFontSize(heightPx: number, isInitials: boolean): number {
  return isInitials
    ? Math.min(heightPx * 0.9, 24)
    : Math.min(heightPx * 0.85, 28);
}

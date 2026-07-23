// Shared signature font map used by finalize-document and download-audit-pdf.
// Keys are the CSS font-family strings emitted by SignDocument.tsx SIGNATURE_FONTS.
import { StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

export const DEFAULT_SIG_FONT = "'Dancing Script', cursive";

export const FONT_SOURCES: Record<string, { url?: string; standard?: keyof typeof StandardFonts }> = {
  "'Dancing Script', cursive": { url: "https://fonts.gstatic.com/s/dancingscript/v29/If2cXTr6YS-zF4S-kcSWSVi_sxjsohD9F50Ruu7BMSo3Sup5.ttf" },
  "'Great Vibes', cursive": { url: "https://raw.githubusercontent.com/google/fonts/main/ofl/greatvibes/GreatVibes-Regular.ttf" },
  "'Pacifico', cursive": { url: "https://raw.githubusercontent.com/google/fonts/main/ofl/pacifico/Pacifico-Regular.ttf" },
  "'Times New Roman', Times, serif": { standard: "TimesRomanBold" },
  "Georgia, serif": { standard: "TimesRomanBold" },
  "'Courier New', Courier, monospace": { standard: "CourierBold" },
};

// Shared sizing formula so preview overlays and flattened PDF text align.
export function signatureFontSize(heightPx: number, isInitials: boolean): number {
  return isInitials
    ? Math.min(heightPx * 0.9, 24)
    : Math.min(heightPx * 0.85, 28);
}

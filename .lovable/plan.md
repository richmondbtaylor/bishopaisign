# Multi-signer editor improvements

## 1. Signers panel (inline list)
In `src/pages/DocumentEditor.tsx`, replace the current signer input area with an inline list:
- Each row: color chip (auto-assigned from a fixed palette), name input, email input, remove button
- "Add signer" button appends a new row
- Clicking a row makes it the **active signer** (highlighted); newly dropped fields inherit that signer + color
- Drag-handle to reorder rows — order is persisted as `signing_order` (matters for sequential mode)
- Color chip is derived from signer index so field overlays on the PDF match the panel

## 2. Sticky + collapsible side panel with page minimap
- Wrap the right-hand panel in a sticky container (`position: sticky; top: <header offset>; max-height: calc(100vh - offset); overflow-y: auto`) so it follows scroll on long PDFs
- Collapse toggle button in the panel header — collapsed state shrinks to a narrow icon rail (tools + signer color chips still visible)
- Add a **page minimap**: vertical strip of small numbered page thumbnails; clicking one scrolls the main canvas to that page. Current page is highlighted based on scroll position (IntersectionObserver on each page wrapper)

## 3. Per-field signer reassignment
- Each placed field on the canvas gets a small dropdown (shown on hover/selection) listing all signers with their color chips
- Changing selection updates `document_fields.signer_id` and re-colors the field immediately
- Default on drop = active signer (existing behavior preserved)

## 4. Signer view: hide unassigned fields entirely
- `src/pages/SignDocument.tsx` already receives fields from `signing-session`. Update `signing-session/index.ts` to filter fields server-side to only those where `signer_id = current signer.id` OR `signer_id IS NULL` (unassigned = anyone). Fields belonging to other signers are not returned at all.
- Client renders only what it receives (no code change needed beyond confirming the filter is exhaustive)

## 5. Send flow (no changes needed to routing)
Sequential + parallel modes already exist and work per-signer. Because each signer now has explicit field ownership and the session endpoint only returns their fields, invitations will naturally scope each signer to their own boxes.

---

## Technical notes
- No DB migration required — `document_fields.signer_id` and `document_signers.signing_order` already exist
- Files touched:
  - `src/pages/DocumentEditor.tsx` — signers list UI, sticky panel, minimap, per-field reassign dropdown
  - `src/pages/SignDocument.tsx` — confirm it renders only returned fields (likely no change)
  - `supabase/functions/signing-session/index.ts` — server-side field filter by `signer_id`
- Color palette: 6-8 distinct accessible colors cycled by signer index (navy/gold theme-aware)
- IntersectionObserver used for minimap active-page detection to avoid scroll-listener jank

## Out of scope
- Changes to signing order enforcement (already server-enforced)
- Email template changes
- Template editor (`Templates.tsx`) — same patterns can be applied later if desired

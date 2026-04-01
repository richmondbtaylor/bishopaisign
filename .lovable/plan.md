

## Plan: Fix All Broken Features in SignVault

### Issues Identified

1. **Drag-and-drop fields not working properly** — Fields drop onto the canvas but aren't bound to a specific signer. No active signer selector exists, so all fields default to `signerIndex: 0` and don't change when switching signers.

2. **Fields don't update per signer** — No concept of "active signer" in the editor. Fields should be color-coded and filterable per signer, with a selector to assign fields to different signers.

3. **Emails not sending** — No email-sending logic exists. When a document is "sent", it just updates the DB status. Need a backend function to email signing links to signers.

4. **Templates page 404** — `/templates` route is linked in the Dashboard navbar but doesn't exist in `App.tsx`. Need a Templates list page and route.

5. **Dashboard organization** — Documents need filtering/sorting by status, search, and better categorization (tabs or filters for Draft, Sent, In Progress, Completed).

### Implementation Steps

#### 1. Fix Drag-and-Drop with Active Signer Binding (DocumentEditor.tsx)
- Add `activeSignerIndex` state to track which signer's fields are being placed
- Add a signer selector (clickable signer tabs in sidebar) that highlights the active signer
- When dropping a field, bind it to `activeSignerIndex` instead of hardcoded `0`
- Filter/highlight fields on canvas by active signer (show all, but bold the active signer's)
- Make placed fields draggable for repositioning (mouse move handler)
- Save `signer_id` correctly when persisting fields to DB

#### 2. Build Templates Page (new: `src/pages/Templates.tsx`)
- Create a Templates list page showing saved templates with name, description, field count
- Add "Use Template" button that creates a new document from a template
- Add "Create Template" flow from the document editor (save current doc as template)
- Register `/templates` route in `App.tsx`

#### 3. Add Email Notifications via Edge Function
- Create `send-sign-request` edge function that:
  - Takes `documentId` as input
  - Fetches document + signers from DB using service role
  - Generates signing URLs (`{origin}/sign/{token}`)
  - Sends emails to each signer (sequential mode: only first; parallel: all)
  - Logs `signing_link_sent` audit events
- Call this edge function from DocumentEditor when "Send for Signature" is clicked

#### 4. Improve Dashboard Organization (Dashboard.tsx)
- Add status filter tabs: All, Draft, Sent, In Progress, Completed
- Add search bar to filter documents by title
- Add sort options (newest, oldest, recently updated)
- Show document count per status tab
- Add bulk actions (delete drafts)

#### 5. Fix Field-Signer Association in SignDocument.tsx
- Filter fields shown to the current signer (match `signer_id` to the signer's ID)
- Only show fields assigned to the viewing signer, not all fields

### Technical Details

- **Active signer state**: `useState<number>(0)` for `activeSignerIndex`, passed to drop handler
- **Edge function**: Uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS, Lovable AI for email content generation is unnecessary — simple HTML template suffices
- **Email sending**: Will use Lovable's built-in email infrastructure (check domain status first) or a simple edge function that calls the Lovable email API
- **Templates route**: Protected with `<RequireAuth>`, queries `templates` + `template_fields` tables

### Files to Create/Modify
- `src/pages/DocumentEditor.tsx` — Active signer, improved drag-drop, field repositioning, save-as-template
- `src/pages/Dashboard.tsx` — Status tabs, search, sorting
- `src/pages/Templates.tsx` — New templates list page
- `src/App.tsx` — Add `/templates` route
- `supabase/functions/send-sign-request/index.ts` — New edge function for email delivery


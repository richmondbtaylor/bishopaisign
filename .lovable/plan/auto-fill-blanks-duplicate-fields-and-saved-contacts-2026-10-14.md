## Auto-fill blanks, duplicate fields, and saved contacts

### 1. Auto-detect and place fields
- New "Auto-place fields" button in the editor once a PDF is loaded.
- The PDF is analyzed securely on the server by AI, which finds blanks such as signature lines, initials, dates, names, checkboxes, and text boxes, with their page and position.
- Detected fields appear as suggestions on the PDF, assigned to the current active signer (or split across signers when the form labels them, e.g. "Buyer" / "Seller").
- You review them: accept all, remove any, move or resize as usual. Nothing is saved until you click Save.
- Also works in the template editor.

### 2. Duplicate fields
- A Duplicate button on the selected-field toolbar (and Ctrl/Cmd+D on desktop) copies a field with its type, size, label, and signer, slightly offset.
- "Duplicate to all pages" option for repeated items like initials in a footer.
- "Duplicate for another signer" copies the field and assigns it to a chosen signer.
- Touch-friendly on mobile.

### 3. Saved contacts
- A personal contact book: name, email, optional phone and company.
- Every email you send to is saved automatically (no duplicates; names update when you add one).
- In the signer box, typing a name or email suggests matching saved contacts; one tap fills both.
- A Contacts page (in the main menu) to search, add, edit, and delete contacts.
- Template "send to recipients" also suggests saved contacts.
- Only you can see your contacts.

### Technical details
- New `contacts` table (owner_id, name, email, phone, company, last_used_at), unique per owner+email, owner-only RLS with grants; backfill from existing document_signers of each sender.
- Upsert contacts client-side when a document is sent; also in send-template.
- New authenticated Edge Function `detect-fields`: verifies document ownership, downloads PDF server-side, sends to Lovable AI Gateway (openai/gpt-6-astra, Responses, strict structured output) returning page, type, label, signer role, and percentage box coordinates. Coordinates stay percentage-based and are clamped to the page.
- Duplicate implemented in DocumentEditor field state; reuses existing field insert flow.
- Contact autocomplete via existing Popover/Command components; new /contacts route behind RequireAuth.
- Verify with a sample contract: auto-place, duplicate, send, then confirm the contact is suggested on the next document, at phone and desktop widths.

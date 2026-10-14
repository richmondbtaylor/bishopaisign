## Void signed documents, view final copies, and delete saved docs

### 1. Void (nullify) a document
- New "Void document" action on the document page and the dashboard menu, for sent, in-progress, and signed documents.
- You confirm and give a short reason.
- The document's status becomes "Voided". Pending signing links stop working right away.
- If it was signed, the final PDF gets a clear "VOID" stamp on every page, plus the date and reason. The original signed copy is kept for your records.
- Every signer gets an email saying the document was voided, with the reason.
- The audit trail records who voided it, when, and why. Nothing gets erased.
- The dashboard gets a "Voided" filter and badge.

### 2. See the final copy of any document
- New "View final copy" button on every document, which opens the PDF right in the app (no download needed):
  - Signed: the completed signed PDF.
  - Voided: the stamped void copy, with a switch to see the original signed copy.
  - Not finished yet: the current PDF with everything filled in so far, labeled "In progress".
- You can download from the viewer too. It works on phones.

### 3. Delete
- **Dashboard documents:** Delete any document (draft, sent, signed, or voided) after a confirmation that says what will be removed. A sent or in-progress document is voided first so signers can't keep signing it. The file, its fields, and its signers are removed. A small record in your audit log keeps the name and date of the deleted document.
- **Saved PDF picker:** "Delete" now removes the PDF for good. If any document still uses that PDF, the file stays and only the picker entry is removed, so those documents don't break. The picker will say which of these two happened.

### Technical details
- Additive schema: add voided_at, voided_by, void_reason, and voided_file_path to documents, plus 'voided' as an allowed status. A separate deleted_documents log table (owner-only access) keeps audit history after deletion, because audit_logs cascade with the document.
- New authenticated Edge Functions:
  - `void-document`: checks the user is the sender, sets the status, makes signer tokens unusable, stamps the PDF server-side with pdf-lib, writes the audit log, and queues a "signing-voided" email to each signer.
  - `delete-document`: checks the user is the sender, voids the document first if it is still active, removes storage files and child rows with the service role, and writes to deleted_documents.
  - `delete-saved-pdf`: removes the storage object only when no document uses that path; otherwise it just deletes the library row.
- signing-session and submit-signature reject voided documents.
- Final-copy viewer is a react-pdf canvas dialog (no iframes) loading a short-lived signed URL. The in-progress preview reuses the existing finalize rendering in preview mode and is never saved.
- New "signing-voided" transactional email template, added to the registry.
- Verify: void a signed test document (check the stamp, email log, and dead link), view final copies in each state, delete each kind of document, and delete a shared and an unshared saved PDF, at phone and desktop widths.

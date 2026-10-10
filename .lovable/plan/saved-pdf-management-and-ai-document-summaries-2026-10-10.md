## Saved PDF management and AI document summaries

### What I verified

- The saved PDF picker currently loads recent document rows, deduplicates them by storage path, and offers only a select action. It has no independent library record, search state, rename action, or safe hide/delete behavior.
- One stored PDF can be referenced by several documents. Per your choice, Delete will hide the PDF from the picker without deleting its private file or breaking existing documents.
- Uploaded PDFs are already validated, stored in the private documents bucket, and associated with sender-owned document records.
- There is no existing AI document-analysis call or saved analysis data.

### 1. Create a sender-owned saved PDF library

- Add a `saved_pdfs` table containing owner, private storage path, display name, hidden state, and timestamps.
- Backfill one library entry per existing sender and file path so PDFs already visible in the picker remain available.
- Enforce strict row-level access so senders can only list, rename, or hide their own saved PDFs; the server function can read only after validating the signed-in sender.
- Automatically add newly uploaded PDFs to the library without duplicating an existing owner/path pair.

### 2. Add search, rename, and hide controls

- Replace the picker’s document-row query with the saved PDF library.
- Add instant name search, an empty search result, and a clear-search control.
- Add a compact action menu to every saved PDF with Rename and Delete.
- Rename edits only the reusable library name, not historical document titles.
- Delete asks for confirmation, then marks the library item hidden. The underlying private PDF and all sent, signed, audit, and download history remain intact.
- Keep selecting a saved PDF as the primary row action and retain the responsive mobile layout.

### 3. Add secure AI PDF analysis

- Add an authenticated `analyze-document` server function that accepts a sender-owned document ID, verifies access, and downloads the PDF from private storage on the server.
- Send the PDF to Lovable AI Gateway using the default `openai/gpt-6-astra` Responses model with low reasoning, streaming the gateway request and consuming the structured result server-side.
- Request a concise overview plus separate structured lists for key clauses, deadlines, and obligations. Each item will include a short title, explanation, and page reference when the model can identify one.
- Keep the AI key, PDF bytes, prompt, and model call server-side. Forward only safe AI correlation headers and surface safe gateway errors, including insufficient credits, without retrying terminal failures.
- Treat the analysis as informational and show a clear “not legal advice” note.

### 4. Save and display analysis results

- Add a `document_ai_summaries` table tied one-to-one to a document, with structured result data, model, status, error, and timestamps.
- Limit access to the document sender and authorized workspace members using the existing document access rules; only the server function writes generated results.
- In the document editor, add an “Analyze with AI” action after a PDF is uploaded or selected. If needed, save the draft first so the server can securely access the file.
- Show analyzing, completed, empty, failed, and re-analyze states in a collapsible panel that works on mobile.
- Also display the saved analysis on the sender’s document details page so it remains available after sending or reopening the document.

### 5. Validation

- Test saved PDF search, rename, hide, duplicate-path handling, and selection.
- Test that hiding a library entry does not remove its storage object or affect an existing document download.
- Test the server function’s authentication, document ownership checks, PDF validation, structured AI output, persisted result, safe failure states, and no-answer handling.
- Run one real AI Gateway request with an uploaded PDF and verify the returned clauses, deadlines, and obligations render in both the editor and document details page.
- Recheck mobile picker controls and the AI panel at phone, tablet, and desktop widths.

## Technical details

- Schema changes are additive: new `saved_pdfs` and `document_ai_summaries` tables with grants, indexes, RLS, and owner-scoped policies.
- The AI implementation uses a server-only Edge Function, the AI SDK Responses adapter, request-local Lovable AI run-ID propagation, and strict structured output.
- PDF rendering remains `react-pdf`; analysis does not introduce iframe viewing or expose private storage URLs to the model from the browser.
- Existing document, storage, audit, signing, and download behavior remains unchanged.
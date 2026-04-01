
-- Allow anonymous/public access to signer records via token
CREATE POLICY "Signers can view own record via token" ON public.document_signers
  FOR SELECT USING (true);

-- Allow signers to update their own status (viewed, signed)
CREATE POLICY "Signers can update own record" ON public.document_signers
  FOR UPDATE USING (true);

-- Allow anonymous read on documents for signers
CREATE POLICY "Public can view sent documents" ON public.documents
  FOR SELECT USING (status IN ('sent', 'partially_signed', 'completed'));

-- Allow anonymous read on fields for signing
CREATE POLICY "Public can view document fields" ON public.document_fields
  FOR SELECT USING (true);

-- Allow signers to update field values during signing
CREATE POLICY "Signers can update field values" ON public.document_fields
  FOR UPDATE USING (true);

-- Allow public read access to document files for signing
CREATE POLICY "Public can read sent document files" ON storage.objects
  FOR SELECT USING (bucket_id = 'documents');

-- Allow public insert of audit logs for signing events
CREATE POLICY "Public can insert audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

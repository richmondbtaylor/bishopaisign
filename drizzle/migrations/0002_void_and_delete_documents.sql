ALTER TABLE public.documents DROP CONSTRAINT documents_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_status_check CHECK (status = ANY (ARRAY['draft','sent','partially_signed','completed','declined','expired','voided']));
ALTER TABLE public.documents ADD COLUMN voided_at timestamptz, ADD COLUMN voided_by uuid, ADD COLUMN void_reason text, ADD COLUMN voided_file_path text;

CREATE TABLE public.deleted_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  document_id uuid NOT NULL,
  title text NOT NULL,
  status_at_deletion text NOT NULL,
  signer_emails text[] NOT NULL DEFAULT '{}',
  deleted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.deleted_documents TO authenticated;
GRANT ALL ON public.deleted_documents TO service_role;
ALTER TABLE public.deleted_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read deleted documents" ON public.deleted_documents FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE INDEX deleted_documents_owner_idx ON public.deleted_documents (owner_id, deleted_at DESC);
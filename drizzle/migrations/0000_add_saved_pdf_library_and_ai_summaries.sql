CREATE TABLE public.saved_pdfs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  file_path text NOT NULL,
  display_name text NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, file_path)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_pdfs TO authenticated;
GRANT ALL ON public.saved_pdfs TO service_role;
ALTER TABLE public.saved_pdfs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read saved PDFs"
ON public.saved_pdfs FOR SELECT TO authenticated
USING (owner_id = auth.uid());

CREATE POLICY "Owners add saved PDFs"
ON public.saved_pdfs FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners update saved PDFs"
ON public.saved_pdfs FOR UPDATE TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners delete saved PDFs"
ON public.saved_pdfs FOR DELETE TO authenticated
USING (owner_id = auth.uid());

CREATE INDEX saved_pdfs_owner_visible_idx
ON public.saved_pdfs (owner_id, hidden, updated_at DESC);

CREATE TRIGGER update_saved_pdfs_updated_at
BEFORE UPDATE ON public.saved_pdfs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.saved_pdfs (owner_id, file_path, display_name, created_at, updated_at)
SELECT DISTINCT ON (d.sender_id, d.file_path)
  d.sender_id,
  d.file_path,
  d.title,
  d.created_at,
  d.updated_at
FROM public.documents d
WHERE d.file_path IS NOT NULL
ORDER BY d.sender_id, d.file_path, d.updated_at DESC
ON CONFLICT (owner_id, file_path) DO NOTHING;

CREATE TABLE public.document_ai_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  overview text,
  clauses jsonb NOT NULL DEFAULT '[]'::jsonb,
  deadlines jsonb NOT NULL DEFAULT '[]'::jsonb,
  obligations jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text NOT NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.document_ai_summaries TO authenticated;
GRANT ALL ON public.document_ai_summaries TO service_role;
ALTER TABLE public.document_ai_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Senders read document AI summaries"
ON public.document_ai_summaries FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.documents d
  WHERE d.id = document_ai_summaries.document_id
    AND (
      d.sender_id = auth.uid()
      OR (d.organization_id IS NOT NULL AND public.is_org_member(d.organization_id, auth.uid()))
    )
));

CREATE INDEX document_ai_summaries_document_idx
ON public.document_ai_summaries (document_id);

CREATE TRIGGER update_document_ai_summaries_updated_at
BEFORE UPDATE ON public.document_ai_summaries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
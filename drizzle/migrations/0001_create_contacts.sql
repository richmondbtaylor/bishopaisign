CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text,
  email text NOT NULL,
  phone text,
  company text,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read contacts" ON public.contacts FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Owners insert contacts" ON public.contacts FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners update contacts" ON public.contacts FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners delete contacts" ON public.contacts FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE INDEX contacts_owner_last_used_idx ON public.contacts (owner_id, last_used_at DESC);
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.contacts (owner_id, name, email, last_used_at)
SELECT d.sender_id, (array_agg(s.name ORDER BY s.created_at DESC) FILTER (WHERE s.name IS NOT NULL))[1], lower(trim(s.email)), max(s.created_at)
FROM public.document_signers s JOIN public.documents d ON d.id = s.document_id
WHERE s.email IS NOT NULL AND trim(s.email) <> ''
GROUP BY d.sender_id, lower(trim(s.email))
ON CONFLICT (owner_id, email) DO NOTHING;
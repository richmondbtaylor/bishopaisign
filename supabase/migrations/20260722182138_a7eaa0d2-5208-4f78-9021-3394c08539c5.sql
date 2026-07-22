
-- Roles
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Email log: link to document & signer
ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signer_id uuid REFERENCES public.document_signers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_send_log_document ON public.email_send_log(document_id);
CREATE INDEX IF NOT EXISTS idx_email_send_log_signer ON public.email_send_log(signer_id);

-- Allow senders to read email log for their own documents; admins read all
DROP POLICY IF EXISTS "Senders read own document emails" ON public.email_send_log;
CREATE POLICY "Senders read own document emails" ON public.email_send_log FOR SELECT TO authenticated
USING (
  document_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.documents d WHERE d.id = document_id AND d.sender_id = auth.uid())
);

DROP POLICY IF EXISTS "Admins read all emails" ON public.email_send_log;
CREATE POLICY "Admins read all emails" ON public.email_send_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.email_send_log TO authenticated;

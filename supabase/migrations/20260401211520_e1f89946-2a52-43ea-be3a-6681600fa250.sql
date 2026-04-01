
-- Timestamp trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  organization_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Organizations
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#0d9668',
  subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'team', 'enterprise')),
  document_limit INTEGER NOT NULL DEFAULT 5,
  documents_used INTEGER NOT NULL DEFAULT 0,
  billing_cycle_start TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Organization members with roles
CREATE TYPE public.org_role AS ENUM ('admin', 'member');

CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role org_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Org RLS: members can see their own org
CREATE POLICY "Members can view own org" ON public.organizations FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = id AND user_id = auth.uid())
);
CREATE POLICY "Admins can update own org" ON public.organizations FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = id AND user_id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Members can view memberships" ON public.organization_members FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins can manage members" ON public.organization_members FOR ALL USING (
  EXISTS (SELECT 1 FROM public.organization_members om WHERE om.organization_id = organization_members.organization_id AND om.user_id = auth.uid() AND om.role = 'admin')
);

-- Add FK from profiles to organizations
ALTER TABLE public.profiles ADD CONSTRAINT profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Documents
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_signed', 'completed', 'declined', 'expired')),
  file_path TEXT,
  completed_file_path TEXT,
  signing_mode TEXT NOT NULL DEFAULT 'parallel' CHECK (signing_mode IN ('sequential', 'parallel')),
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  template_id UUID,
  sms_auth_required BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_documents_sender ON public.documents(sender_id);
CREATE INDEX idx_documents_status ON public.documents(status);
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Senders can view own documents" ON public.documents FOR SELECT USING (sender_id = auth.uid());
CREATE POLICY "Senders can create documents" ON public.documents FOR INSERT WITH CHECK (sender_id = auth.uid());
CREATE POLICY "Senders can update own documents" ON public.documents FOR UPDATE USING (sender_id = auth.uid());
CREATE POLICY "Senders can delete draft documents" ON public.documents FOR DELETE USING (sender_id = auth.uid() AND status = 'draft');

-- Document Signers
CREATE TABLE public.document_signers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  name TEXT,
  signing_order INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'viewed', 'signed', 'declined')),
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  auth_method TEXT NOT NULL DEFAULT 'email' CHECK (auth_method IN ('email', 'sms')),
  phone_number TEXT,
  sms_code TEXT,
  sms_verified BOOLEAN DEFAULT false,
  signed_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.document_signers ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_signers_document ON public.document_signers(document_id);
CREATE INDEX idx_signers_token ON public.document_signers(token);
CREATE TRIGGER update_signers_updated_at BEFORE UPDATE ON public.document_signers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Signers: document owner can manage, signers can view/update own via token (handled in app layer)
CREATE POLICY "Sender can view signers" ON public.document_signers FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.documents WHERE id = document_id AND sender_id = auth.uid())
);
CREATE POLICY "Sender can manage signers" ON public.document_signers FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.documents WHERE id = document_id AND sender_id = auth.uid())
);
CREATE POLICY "Sender can update signers" ON public.document_signers FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.documents WHERE id = document_id AND sender_id = auth.uid())
);
CREATE POLICY "Sender can delete signers" ON public.document_signers FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.documents WHERE id = document_id AND sender_id = auth.uid())
);

-- Document Fields
CREATE TABLE public.document_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  signer_id UUID REFERENCES public.document_signers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('signature', 'text', 'checkbox', 'date', 'initials', 'dropdown')),
  page_number INTEGER NOT NULL DEFAULT 1,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  width DOUBLE PRECISION NOT NULL,
  height DOUBLE PRECISION NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  label TEXT,
  placeholder TEXT,
  options JSONB,
  value TEXT,
  signature_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.document_fields ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_fields_document ON public.document_fields(document_id);
CREATE TRIGGER update_fields_updated_at BEFORE UPDATE ON public.document_fields FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Sender can view fields" ON public.document_fields FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.documents WHERE id = document_id AND sender_id = auth.uid())
);
CREATE POLICY "Sender can manage fields" ON public.document_fields FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.documents WHERE id = document_id AND sender_id = auth.uid())
);
CREATE POLICY "Sender can update fields" ON public.document_fields FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.documents WHERE id = document_id AND sender_id = auth.uid())
);
CREATE POLICY "Sender can delete fields" ON public.document_fields FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.documents WHERE id = document_id AND sender_id = auth.uid())
);

-- Templates
CREATE TABLE public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT,
  creator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Creator can view templates" ON public.templates FOR SELECT USING (creator_id = auth.uid());
CREATE POLICY "Creator can manage templates" ON public.templates FOR INSERT WITH CHECK (creator_id = auth.uid());
CREATE POLICY "Creator can update templates" ON public.templates FOR UPDATE USING (creator_id = auth.uid());
CREATE POLICY "Creator can delete templates" ON public.templates FOR DELETE USING (creator_id = auth.uid());

-- Template Fields
CREATE TABLE public.template_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.templates(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('signature', 'text', 'checkbox', 'date', 'initials', 'dropdown')),
  signer_index INTEGER NOT NULL DEFAULT 0,
  page_number INTEGER NOT NULL DEFAULT 1,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  width DOUBLE PRECISION NOT NULL,
  height DOUBLE PRECISION NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  label TEXT,
  placeholder TEXT,
  options JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.template_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Creator can view template fields" ON public.template_fields FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.templates WHERE id = template_id AND creator_id = auth.uid())
);
CREATE POLICY "Creator can manage template fields" ON public.template_fields FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.templates WHERE id = template_id AND creator_id = auth.uid())
);
CREATE POLICY "Creator can update template fields" ON public.template_fields FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.templates WHERE id = template_id AND creator_id = auth.uid())
);
CREATE POLICY "Creator can delete template fields" ON public.template_fields FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.templates WHERE id = template_id AND creator_id = auth.uid())
);

-- Audit Logs (immutable)
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  action TEXT NOT NULL,
  actor_email TEXT,
  actor_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_audit_document ON public.audit_logs(document_id);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at);

-- Audit logs: read-only for document owner
CREATE POLICY "Sender can view audit logs" ON public.audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.documents WHERE id = document_id AND sender_id = auth.uid())
);
CREATE POLICY "System can insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK (true);

-- Storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

CREATE POLICY "Authenticated users can upload documents" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]
);
CREATE POLICY "Users can view own documents" ON storage.objects FOR SELECT USING (
  bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]
);
CREATE POLICY "Users can delete own documents" ON storage.objects FOR DELETE USING (
  bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Add FK from documents to templates
ALTER TABLE public.documents ADD CONSTRAINT documents_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE SET NULL;

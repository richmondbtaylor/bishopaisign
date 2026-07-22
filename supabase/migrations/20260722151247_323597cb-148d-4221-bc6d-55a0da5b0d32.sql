
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Public can view sent documents" ON public.documents;
DROP POLICY IF EXISTS "Public can view document fields" ON public.document_fields;
DROP POLICY IF EXISTS "Signers can update field values" ON public.document_fields;
DROP POLICY IF EXISTS "Signers can view own record via token" ON public.document_signers;
DROP POLICY IF EXISTS "Signers can update own record" ON public.document_signers;
DROP POLICY IF EXISTS "Public can insert audit logs" ON public.audit_logs;

-- Fix organizations self-reference bug
DROP POLICY IF EXISTS "Admins can update own org" ON public.organizations;
DROP POLICY IF EXISTS "Members can view own org" ON public.organizations;

CREATE POLICY "Admins can update own org" ON public.organizations
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.organization_members om
  WHERE om.organization_id = organizations.id
    AND om.user_id = auth.uid()
    AND om.role = 'admin'::org_role
));

CREATE POLICY "Members can view own org" ON public.organizations
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.organization_members om
  WHERE om.organization_id = organizations.id
    AND om.user_id = auth.uid()
));

-- Remove public read on storage bucket
DROP POLICY IF EXISTS "Public can read sent document files" ON storage.objects;

-- Revoke EXECUTE on internal trigger SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

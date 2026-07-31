
CREATE POLICY "Org members can view teammate profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()));

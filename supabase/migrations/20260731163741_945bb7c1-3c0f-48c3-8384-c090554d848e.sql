
DROP POLICY IF EXISTS "Authenticated can create organizations" ON public.organizations;
CREATE POLICY "Authenticated can create organizations" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

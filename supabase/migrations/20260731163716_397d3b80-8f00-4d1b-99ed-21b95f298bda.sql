
CREATE OR REPLACE FUNCTION public.is_org_member(_org uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = _org AND user_id = _user)
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(_org uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = _org AND user_id = _user AND role = 'admin')
$$;

REVOKE ALL ON FUNCTION public.is_org_member(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.is_org_admin(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_org_admin(uuid, uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role org_role NOT NULL DEFAULT 'member',
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_invites_token_idx ON public.organization_invitations(token);
CREATE INDEX IF NOT EXISTS org_invites_email_idx ON public.organization_invitations(lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_invitations TO authenticated;
GRANT ALL ON public.organization_invitations TO service_role;
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage invitations" ON public.organization_invitations
  FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id, auth.uid()))
  WITH CHECK (public.is_org_admin(organization_id, auth.uid()) AND invited_by = auth.uid());

CREATE POLICY "Invitee can view own invitation" ON public.organization_invitations
  FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));

-- Anyone signed in can create a workspace
CREATE POLICY "Authenticated can create organizations" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (true);

-- Allow a user to add themselves as the first member (creator) of an org with no members
CREATE POLICY "Creator can join empty org" ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id = organization_members.organization_id)
  );

-- Members can see each other
CREATE POLICY "Members can view org memberships" ON public.organization_members
  FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id, auth.uid()));

-- Accept invitation
CREATE OR REPLACE FUNCTION public.accept_org_invitation(_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.organization_invitations%ROWTYPE; uid uuid := auth.uid(); mail text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO mail FROM auth.users WHERE id = uid;
  SELECT * INTO inv FROM public.organization_invitations WHERE token = _token AND status = 'pending';
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invitation not found or already used'; END IF;
  IF lower(inv.email) <> lower(mail) THEN RAISE EXCEPTION 'This invitation was sent to a different email address'; END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (inv.organization_id, uid, inv.role)
  ON CONFLICT DO NOTHING;
  UPDATE public.organization_invitations SET status = 'accepted', accepted_at = now() WHERE id = inv.id;
  UPDATE public.profiles SET organization_id = inv.organization_id WHERE user_id = uid AND organization_id IS NULL;
  RETURN inv.organization_id;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_org_invitation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_org_invitation(uuid) TO authenticated;

-- Workspace sharing of templates, documents and audit logs
CREATE POLICY "Org members can view templates" ON public.templates
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()));

CREATE POLICY "Org members can update templates" ON public.templates
  FOR UPDATE TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()));

CREATE POLICY "Org members can view documents" ON public.documents
  FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()));

CREATE POLICY "Org members can view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = audit_logs.document_id
      AND d.organization_id IS NOT NULL
      AND public.is_org_member(d.organization_id, auth.uid())
  ));

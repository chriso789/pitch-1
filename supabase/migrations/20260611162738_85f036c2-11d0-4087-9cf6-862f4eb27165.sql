DROP POLICY IF EXISTS "Owners and admins can manage approval requirements" ON public.tenant_approval_requirements;
DROP POLICY IF EXISTS "Users can view their tenant's approval requirements" ON public.tenant_approval_requirements;

CREATE POLICY "View tenant approval requirements"
ON public.tenant_approval_requirements
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'master'::app_role)
  OR tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())
);

CREATE POLICY "Manage tenant approval requirements"
ON public.tenant_approval_requirements
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'master'::app_role)
  OR tenant_id IN (
    SELECT p.tenant_id FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = ANY (ARRAY['owner'::app_role, 'corporate'::app_role, 'office_admin'::app_role, 'master'::app_role])
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'master'::app_role)
  OR tenant_id IN (
    SELECT p.tenant_id FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = ANY (ARRAY['owner'::app_role, 'corporate'::app_role, 'office_admin'::app_role, 'master'::app_role])
  )
);
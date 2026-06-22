CREATE POLICY "Tenant managers can insert crews"
ON public.crews FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = get_user_tenant_id()
  AND (
    has_role(auth.uid(), 'master'::app_role)
    OR has_role(auth.uid(), 'owner'::app_role)
    OR has_role(auth.uid(), 'corporate'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR has_role(auth.uid(), 'regional_manager'::app_role)
    OR has_role(auth.uid(), 'sales_manager'::app_role)
    OR has_role(auth.uid(), 'project_manager'::app_role)
  )
);

CREATE POLICY "Tenant managers can update crews"
ON public.crews FOR UPDATE TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND (
    has_role(auth.uid(), 'master'::app_role)
    OR has_role(auth.uid(), 'owner'::app_role)
    OR has_role(auth.uid(), 'corporate'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
    OR has_role(auth.uid(), 'regional_manager'::app_role)
    OR has_role(auth.uid(), 'sales_manager'::app_role)
    OR has_role(auth.uid(), 'project_manager'::app_role)
  )
)
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Tenant managers can delete crews"
ON public.crews FOR DELETE TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND (
    has_role(auth.uid(), 'master'::app_role)
    OR has_role(auth.uid(), 'owner'::app_role)
    OR has_role(auth.uid(), 'corporate'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
  )
);
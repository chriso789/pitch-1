
CREATE POLICY "Admins can manage lead sources in their tenant" 
ON public.lead_sources 
FOR ALL
USING (
  (tenant_id = get_user_tenant_id()) 
  AND (
    public.has_role(auth.uid(), 'master'::app_role) 
    OR public.has_role(auth.uid(), 'owner'::app_role) 
    OR public.has_role(auth.uid(), 'corporate'::app_role) 
    OR public.has_role(auth.uid(), 'office_admin'::app_role)
    OR public.has_role(auth.uid(), 'regional_manager'::app_role)
    OR public.has_role(auth.uid(), 'sales_manager'::app_role)
  )
)
WITH CHECK (
  (tenant_id = get_user_tenant_id()) 
  AND (
    public.has_role(auth.uid(), 'master'::app_role) 
    OR public.has_role(auth.uid(), 'owner'::app_role) 
    OR public.has_role(auth.uid(), 'corporate'::app_role) 
    OR public.has_role(auth.uid(), 'office_admin'::app_role)
    OR public.has_role(auth.uid(), 'regional_manager'::app_role)
    OR public.has_role(auth.uid(), 'sales_manager'::app_role)
  )
);

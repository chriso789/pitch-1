DROP POLICY IF EXISTS "Users can view invoices for their tenant" ON public.project_cost_invoices;
DROP POLICY IF EXISTS "Users can insert invoices for their tenant" ON public.project_cost_invoices;
DROP POLICY IF EXISTS "Users can update invoices for their tenant" ON public.project_cost_invoices;
DROP POLICY IF EXISTS "Users can delete invoices for their tenant" ON public.project_cost_invoices;

CREATE POLICY "Users can view invoices for active tenant"
ON public.project_cost_invoices
FOR SELECT
TO authenticated
USING (
  public.can_view_all_tenants()
  OR tenant_id = public.get_user_tenant_id(auth.uid())
);

CREATE POLICY "Users can insert invoices for active tenant"
ON public.project_cost_invoices
FOR INSERT
TO authenticated
WITH CHECK (
  public.can_view_all_tenants()
  OR tenant_id = public.get_user_tenant_id(auth.uid())
);

CREATE POLICY "Users can update invoices for active tenant"
ON public.project_cost_invoices
FOR UPDATE
TO authenticated
USING (
  public.can_view_all_tenants()
  OR tenant_id = public.get_user_tenant_id(auth.uid())
)
WITH CHECK (
  public.can_view_all_tenants()
  OR tenant_id = public.get_user_tenant_id(auth.uid())
);

CREATE POLICY "Users can delete invoices for active tenant"
ON public.project_cost_invoices
FOR DELETE
TO authenticated
USING (
  public.can_view_all_tenants()
  OR tenant_id = public.get_user_tenant_id(auth.uid())
);
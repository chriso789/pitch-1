DROP POLICY IF EXISTS "Tenant members can view draws" ON public.commission_draws;
DROP POLICY IF EXISTS "Tenant members can update draws" ON public.commission_draws;
DROP POLICY IF EXISTS "Tenant members can delete draws" ON public.commission_draws;
DROP POLICY IF EXISTS "Tenant members can insert draws" ON public.commission_draws;

CREATE POLICY "Tenant members can view draws"
ON public.commission_draws FOR SELECT TO authenticated
USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant members can insert draws"
ON public.commission_draws FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant members can update draws"
ON public.commission_draws FOR UPDATE TO authenticated
USING (tenant_id = public.get_user_tenant_id())
WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant members can delete draws"
ON public.commission_draws FOR DELETE TO authenticated
USING (tenant_id = public.get_user_tenant_id());
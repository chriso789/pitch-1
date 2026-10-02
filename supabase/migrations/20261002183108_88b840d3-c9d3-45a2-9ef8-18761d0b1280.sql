DROP POLICY "tenant insert" ON public.commercial_audit_log;
CREATE POLICY "tenant insert" ON public.commercial_audit_log FOR INSERT TO authenticated WITH CHECK (public.user_can_access_tenant(tenant_id));
DROP POLICY "tenant read" ON public.commercial_audit_log;
CREATE POLICY "tenant read" ON public.commercial_audit_log FOR SELECT TO authenticated USING (public.user_can_access_tenant(tenant_id));
DROP POLICY "tenant read approvals" ON public.commercial_estimate_approvals;
CREATE POLICY "tenant read approvals" ON public.commercial_estimate_approvals FOR SELECT TO authenticated USING (public.user_can_access_tenant(tenant_id));
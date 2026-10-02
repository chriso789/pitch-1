CREATE OR REPLACE FUNCTION public.commercial_can_access_tenant(_tenant_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND _tenant_id IS NOT NULL AND (
    _tenant_id = public.get_user_tenant_id()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.tenant_id = _tenant_id OR p.active_tenant_id = _tenant_id OR p.role = 'master'))
    OR EXISTS (SELECT 1 FROM user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = _tenant_id AND u.is_active)
    OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = auth.uid() AND r.role = 'master')
  )
$$;
REVOKE ALL ON FUNCTION public.commercial_can_access_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_can_access_tenant(uuid) TO authenticated;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.relname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
           WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'commercial\_%' AND p.polname = 'tenant access' LOOP
    EXECUTE format('DROP POLICY "tenant access" ON public.%I', r.relname);
    EXECUTE format('CREATE POLICY "tenant access" ON public.%I FOR ALL TO authenticated USING (public.commercial_can_access_tenant(tenant_id)) WITH CHECK (public.commercial_can_access_tenant(tenant_id))', r.relname);
  END LOOP;
END $$;
DROP POLICY "tenant insert" ON public.commercial_audit_log;
CREATE POLICY "tenant insert" ON public.commercial_audit_log FOR INSERT TO authenticated WITH CHECK (public.commercial_can_access_tenant(tenant_id));
DROP POLICY "tenant read" ON public.commercial_audit_log;
CREATE POLICY "tenant read" ON public.commercial_audit_log FOR SELECT TO authenticated USING (public.commercial_can_access_tenant(tenant_id));
DROP POLICY "tenant read approvals" ON public.commercial_estimate_approvals;
CREATE POLICY "tenant read approvals" ON public.commercial_estimate_approvals FOR SELECT TO authenticated USING (public.commercial_can_access_tenant(tenant_id));
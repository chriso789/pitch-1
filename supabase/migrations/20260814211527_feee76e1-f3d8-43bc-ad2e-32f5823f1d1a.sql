-- 1) Materials tenant isolation
DROP POLICY IF EXISTS "Authenticated users can read materials" ON public.materials;
DROP POLICY IF EXISTS "Admins can manage materials" ON public.materials;

CREATE POLICY "Users read own tenant or global materials"
ON public.materials FOR SELECT TO authenticated
USING (tenant_id IS NULL OR tenant_id = public.get_user_tenant_id() OR public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "Admins manage own tenant materials"
ON public.materials FOR ALL TO authenticated
USING (
  (tenant_id = public.get_user_tenant_id()
   AND (public.has_role(auth.uid(),'corporate'::app_role) OR public.has_role(auth.uid(),'office_admin'::app_role)))
  OR public.has_role(auth.uid(),'master'::app_role)
)
WITH CHECK (
  (tenant_id = public.get_user_tenant_id()
   AND (public.has_role(auth.uid(),'corporate'::app_role) OR public.has_role(auth.uid(),'office_admin'::app_role)))
  OR public.has_role(auth.uid(),'master'::app_role)
);

-- 2) Pin search_path on all non-extension public functions missing it
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    WHERE n.nspname = 'public'
      AND d.objid IS NULL
      AND p.prokind IN ('f','p')
      AND (p.proconfig IS NULL OR NOT EXISTS (
        SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
  END LOOP;
END $$;
-- Block every data path for users whose company is deactivated.
-- A RESTRICTIVE policy is AND-ed with all existing policies, so it can only
-- remove access, never grant it. Wrapped in a sub-select so it evaluates once per query.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "block_deactivated_company" ON public.%I', r.relname);
    EXECUTE format(
      'CREATE POLICY "block_deactivated_company" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT (SELECT public.is_login_blocked())) WITH CHECK (NOT (SELECT public.is_login_blocked()))',
      r.relname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "block_deactivated_company" ON storage.objects;
CREATE POLICY "block_deactivated_company" ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (SELECT public.is_login_blocked()))
  WITH CHECK (NOT (SELECT public.is_login_blocked()));
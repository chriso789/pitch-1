DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.relname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
           WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'commercial\_%' AND p.polname = 'tenant access' LOOP
    EXECUTE format('DROP POLICY "tenant access" ON public.%I', r.relname);
    EXECUTE format('CREATE POLICY "tenant access" ON public.%I FOR ALL TO authenticated USING (public.user_can_access_tenant(tenant_id)) WITH CHECK (public.user_can_access_tenant(tenant_id))', r.relname);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_type_item_map TO authenticated;
GRANT ALL ON public.job_type_item_map TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_type_item_map' AND policyname='Users can insert job type mappings in their tenant') THEN
    CREATE POLICY "Users can insert job type mappings in their tenant"
      ON public.job_type_item_map FOR INSERT TO authenticated
      WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_type_item_map' AND policyname='Users can update job type mappings in their tenant') THEN
    CREATE POLICY "Users can update job type mappings in their tenant"
      ON public.job_type_item_map FOR UPDATE TO authenticated
      USING (tenant_id = public.get_user_tenant_id(auth.uid()))
      WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='job_type_item_map' AND policyname='Users can delete job type mappings in their tenant') THEN
    CREATE POLICY "Users can delete job type mappings in their tenant"
      ON public.job_type_item_map FOR DELETE TO authenticated
      USING (tenant_id = public.get_user_tenant_id(auth.uid()));
  END IF;
END $$;
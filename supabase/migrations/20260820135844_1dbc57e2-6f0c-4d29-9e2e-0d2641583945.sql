DO $$
BEGIN
  BEGIN ALTER TABLE public.estimate_line_items REPLICA IDENTITY FULL; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN ALTER TABLE public.project_budget_items REPLICA IDENTITY FULL; EXCEPTION WHEN undefined_table THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.estimate_line_items; EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.project_budget_items; EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END;
END $$;
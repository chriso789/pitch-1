DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.enhanced_estimates; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.estimates; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.change_orders; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.change_order_line_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_links; EXCEPTION WHEN duplicate_object THEN NULL; END;
END$$;

ALTER TABLE public.enhanced_estimates REPLICA IDENTITY FULL;
ALTER TABLE public.estimates REPLICA IDENTITY FULL;
ALTER TABLE public.change_orders REPLICA IDENTITY FULL;
ALTER TABLE public.project_payments REPLICA IDENTITY FULL;
ALTER TABLE public.project_invoices REPLICA IDENTITY FULL;
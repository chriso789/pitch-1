
CREATE TABLE IF NOT EXISTS public.derived_supplier_price_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  supplier_id UUID,
  supplier_name_canonical TEXT NOT NULL,
  supplier_name_display TEXT NOT NULL,
  sku TEXT,
  normalized_description TEXT NOT NULL,
  item_description TEXT NOT NULL,
  unit_of_measure TEXT,
  lowest_unit_price NUMERIC(12,4) NOT NULL,
  highest_unit_price NUMERIC(12,4) NOT NULL,
  avg_unit_price NUMERIC(12,4) NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 1,
  source_invoice_count INTEGER NOT NULL DEFAULT 1,
  lowest_source_invoice_id UUID,
  last_seen_invoice_date DATE,
  last_built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS derived_price_items_unique
  ON public.derived_supplier_price_items (tenant_id, supplier_name_canonical, COALESCE(sku,''), normalized_description);

CREATE INDEX IF NOT EXISTS derived_price_items_supplier_idx
  ON public.derived_supplier_price_items (tenant_id, supplier_id);

ALTER TABLE public.derived_supplier_price_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read derived prices"
  ON public.derived_supplier_price_items
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "service role manages derived prices"
  ON public.derived_supplier_price_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

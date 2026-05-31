-- A) Supplier SKU mapping fields on calc template items
ALTER TABLE public.estimate_calc_template_items
  ADD COLUMN IF NOT EXISTS srs_sku TEXT,
  ADD COLUMN IF NOT EXISTS abc_sku TEXT,
  ADD COLUMN IF NOT EXISTS qxo_sku TEXT;

-- Seed supplier SKUs from existing sku_pattern when prefixed (e.g. SRS:GAF-...)
UPDATE public.estimate_calc_template_items
SET srs_sku = COALESCE(srs_sku, regexp_replace(sku_pattern, '^SRS:', ''))
WHERE sku_pattern LIKE 'SRS:%' AND srs_sku IS NULL;

-- C) Persistence: template_supplier_prices
CREATE TABLE IF NOT EXISTS public.template_supplier_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  template_id UUID NOT NULL,
  template_item_id UUID NOT NULL REFERENCES public.estimate_calc_template_items(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL CHECK (supplier IN ('srs','abc','qxo')),
  supplier_sku TEXT,
  supplier_item_name TEXT,
  color TEXT,
  branch TEXT,
  account_number TEXT,
  unit_price NUMERIC,
  uom TEXT,
  availability TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('ok','pending','error','not_mapped','not_connected')),
  reason TEXT,
  raw_response JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, template_item_id, supplier)
);

CREATE INDEX IF NOT EXISTS idx_tsp_tenant_template
  ON public.template_supplier_prices(tenant_id, template_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_supplier_prices TO authenticated;
GRANT ALL ON public.template_supplier_prices TO service_role;

ALTER TABLE public.template_supplier_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tsp_tenant_select"
  ON public.template_supplier_prices FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "tsp_tenant_write"
  ON public.template_supplier_prices FOR ALL
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE TRIGGER tsp_set_updated_at
  BEFORE UPDATE ON public.template_supplier_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.material_supplier_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL CHECK (supplier IN ('abc','srs','qxo','other')),
  supplier_item_number TEXT NOT NULL,
  supplier_product_id TEXT,
  manufacturer TEXT,
  product_family TEXT,
  color TEXT,
  uom TEXT,
  mapping_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (mapping_source IN ('system_catalog_match','manual','invoice_ai','order_confirmation')),
  mapping_confidence NUMERIC(3,2),
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, material_id, supplier, supplier_item_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_supplier_skus TO authenticated;
GRANT ALL ON public.material_supplier_skus TO service_role;

ALTER TABLE public.material_supplier_skus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can read supplier SKUs"
  ON public.material_supplier_skus FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant members can write supplier SKUs"
  ON public.material_supplier_skus FOR ALL
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_material_supplier_skus_material
  ON public.material_supplier_skus (material_id);
CREATE INDEX IF NOT EXISTS idx_material_supplier_skus_lookup
  ON public.material_supplier_skus (tenant_id, supplier, supplier_item_number);

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS template_basis_unit_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS template_basis_source TEXT
    CHECK (template_basis_source IN ('manual','historical_blend','imported','initial')),
  ADD COLUMN IF NOT EXISTS template_basis_last_updated TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS historical_average_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS historical_purchase_count INTEGER NOT NULL DEFAULT 0;

UPDATE public.materials
SET template_basis_unit_cost = base_cost,
    template_basis_source = 'initial',
    template_basis_last_updated = now()
WHERE template_basis_unit_cost IS NULL;

CREATE TABLE IF NOT EXISTS public.procurement_cost_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  material_id UUID REFERENCES public.materials(id) ON DELETE SET NULL,
  supplier TEXT NOT NULL CHECK (supplier IN ('abc','srs','qxo','other')),
  supplier_item_number TEXT,
  manufacturer TEXT,
  product_family TEXT,
  color TEXT,
  uom TEXT,
  branch TEXT,
  purchase_date DATE NOT NULL,
  confirmed_unit_cost NUMERIC NOT NULL,
  confirmed_quantity NUMERIC NOT NULL,
  extended_cost NUMERIC NOT NULL,
  supplier_order_id TEXT,
  source_confirmation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_cost_ledger TO authenticated;
GRANT ALL ON public.procurement_cost_ledger TO service_role;

ALTER TABLE public.procurement_cost_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can read ledger"
  ON public.procurement_cost_ledger FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant members can write ledger"
  ON public.procurement_cost_ledger FOR ALL
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_ledger_material_date
  ON public.procurement_cost_ledger (tenant_id, material_id, purchase_date DESC);

CREATE TABLE IF NOT EXISTS public.benchmark_update_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  material_id UUID NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  current_basis_cost NUMERIC,
  suggested_basis_cost NUMERIC NOT NULL,
  sample_size INTEGER NOT NULL,
  weighted_method TEXT NOT NULL DEFAULT 'recency_qty_weighted',
  variance_percent NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','auto_applied')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.benchmark_update_suggestions TO authenticated;
GRANT ALL ON public.benchmark_update_suggestions TO service_role;

ALTER TABLE public.benchmark_update_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can read benchmark suggestions"
  ON public.benchmark_update_suggestions FOR SELECT
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Tenant members can manage benchmark suggestions"
  ON public.benchmark_update_suggestions FOR ALL
  TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_benchmark_pending
  ON public.benchmark_update_suggestions (tenant_id, status, created_at DESC);

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS supplier_quoted_unit_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS supplier_quote_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS supplier_pricing_run_id UUID,
  ADD COLUMN IF NOT EXISTS confirmed_order_unit_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS confirmed_order_total NUMERIC,
  ADD COLUMN IF NOT EXISTS confirmed_order_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cost_variance_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS cost_variance_percent NUMERIC;

CREATE OR REPLACE FUNCTION public.recompute_material_historical_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg NUMERIC;
  v_count INTEGER;
  v_current_basis NUMERIC;
  v_variance NUMERIC;
BEGIN
  IF NEW.material_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    SUM(confirmed_unit_cost * confirmed_quantity) / NULLIF(SUM(confirmed_quantity), 0),
    COUNT(*)
    INTO v_avg, v_count
  FROM public.procurement_cost_ledger
  WHERE material_id = NEW.material_id
    AND tenant_id = NEW.tenant_id
    AND purchase_date >= (CURRENT_DATE - INTERVAL '12 months');

  UPDATE public.materials
     SET historical_average_cost = v_avg,
         historical_purchase_count = v_count
   WHERE id = NEW.material_id;

  SELECT template_basis_unit_cost INTO v_current_basis
    FROM public.materials WHERE id = NEW.material_id;

  IF v_current_basis IS NOT NULL AND v_current_basis > 0 AND v_avg IS NOT NULL THEN
    v_variance := ABS(v_avg - v_current_basis) / v_current_basis * 100;
    IF v_variance >= 8 AND v_count >= 3 THEN
      INSERT INTO public.benchmark_update_suggestions (
        tenant_id, material_id, current_basis_cost, suggested_basis_cost,
        sample_size, variance_percent, status
      )
      SELECT NEW.tenant_id, NEW.material_id, v_current_basis, v_avg,
             v_count, v_variance, 'pending'
      WHERE NOT EXISTS (
        SELECT 1 FROM public.benchmark_update_suggestions
        WHERE material_id = NEW.material_id AND status = 'pending'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_recompute ON public.procurement_cost_ledger;
CREATE TRIGGER trg_ledger_recompute
AFTER INSERT ON public.procurement_cost_ledger
FOR EACH ROW EXECUTE FUNCTION public.recompute_material_historical_cost();

NOTIFY pgrst, 'reload schema';

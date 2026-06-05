
-- ============================================================
-- Part 1: Material baseline auto-lock columns on purchase_orders
-- ============================================================
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS baseline_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS baseline_lock_reason text,
  ADD COLUMN IF NOT EXISTS baseline_supplier text,
  ADD COLUMN IF NOT EXISTS supplier_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_invoice_id uuid;

-- ============================================================
-- Part 1: purchase_order_baseline_snapshots (immutable history)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.purchase_order_baseline_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  lock_reason text NOT NULL,
  lock_supplier text,
  snapshot_subtotal numeric,
  snapshot_total numeric,
  snapshot_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.purchase_order_baseline_snapshots TO authenticated;
GRANT ALL ON public.purchase_order_baseline_snapshots TO service_role;

ALTER TABLE public.purchase_order_baseline_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_baseline_snapshots_tenant_select" ON public.purchase_order_baseline_snapshots;
CREATE POLICY "po_baseline_snapshots_tenant_select"
  ON public.purchase_order_baseline_snapshots
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "po_baseline_snapshots_tenant_insert" ON public.purchase_order_baseline_snapshots;
CREATE POLICY "po_baseline_snapshots_tenant_insert"
  ON public.purchase_order_baseline_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_po_baseline_snapshots_po
  ON public.purchase_order_baseline_snapshots (purchase_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_po_baseline_snapshots_tenant
  ON public.purchase_order_baseline_snapshots (tenant_id, created_at DESC);

-- ============================================================
-- Part 2: link project_cost_invoices back to supplier order
-- ============================================================
ALTER TABLE public.project_cost_invoices
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier text;

CREATE INDEX IF NOT EXISTS idx_project_cost_invoices_po
  ON public.project_cost_invoices (purchase_order_id);

-- Per-line audit fields for supplier-verified invoices
ALTER TABLE public.project_cost_invoice_line_items
  ADD COLUMN IF NOT EXISTS supplier_item_number text,
  ADD COLUMN IF NOT EXISTS purchase_order_item_id uuid REFERENCES public.purchase_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS match_status text,
  ADD COLUMN IF NOT EXISTS baseline_unit_price numeric,
  ADD COLUMN IF NOT EXISTS price_variance_pct numeric;

-- ============================================================
-- Part 3a: template_items cost-source audit fields
-- ============================================================
ALTER TABLE public.template_items
  ADD COLUMN IF NOT EXISTS cost_source text,
  ADD COLUMN IF NOT EXISTS cost_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS last_cost_refresh_at timestamptz;

-- ============================================================
-- Part 3b: tenant_imported_price_sheets
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_imported_price_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplier_label text,
  sku text,
  item_description text,
  uom text,
  unit_price numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  template_item_id uuid REFERENCES public.template_items(id) ON DELETE SET NULL,
  valid_from date,
  valid_until date,
  source_filename text,
  source_row_number integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_imported_price_sheets TO authenticated;
GRANT ALL ON public.tenant_imported_price_sheets TO service_role;

ALTER TABLE public.tenant_imported_price_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tips_tenant_select" ON public.tenant_imported_price_sheets;
CREATE POLICY "tips_tenant_select"
  ON public.tenant_imported_price_sheets
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "tips_tenant_insert" ON public.tenant_imported_price_sheets;
CREATE POLICY "tips_tenant_insert"
  ON public.tenant_imported_price_sheets
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "tips_tenant_update" ON public.tenant_imported_price_sheets;
CREATE POLICY "tips_tenant_update"
  ON public.tenant_imported_price_sheets
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "tips_tenant_delete" ON public.tenant_imported_price_sheets;
CREATE POLICY "tips_tenant_delete"
  ON public.tenant_imported_price_sheets
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_tips_tenant_sku
  ON public.tenant_imported_price_sheets (tenant_id, sku);
CREATE INDEX IF NOT EXISTS idx_tips_tenant_template_item
  ON public.tenant_imported_price_sheets (tenant_id, template_item_id);

-- Auto-stamp tenant_id on insert if missing
CREATE OR REPLACE FUNCTION public.tips_stamp_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.get_user_tenant_id(auth.uid());
  END IF;
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tips_stamp_tenant ON public.tenant_imported_price_sheets;
CREATE TRIGGER trg_tips_stamp_tenant
  BEFORE INSERT ON public.tenant_imported_price_sheets
  FOR EACH ROW EXECUTE FUNCTION public.tips_stamp_tenant();

CREATE OR REPLACE FUNCTION public.update_updated_at_column_tips()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tips_updated_at ON public.tenant_imported_price_sheets;
CREATE TRIGGER trg_tips_updated_at
  BEFORE UPDATE ON public.tenant_imported_price_sheets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column_tips();

NOTIFY pgrst, 'reload schema';

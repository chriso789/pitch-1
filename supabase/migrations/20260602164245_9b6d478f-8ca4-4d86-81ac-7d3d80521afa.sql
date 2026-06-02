-- ============================================================================
-- Phase 1: Side-by-side supplier pricing for template items
-- ============================================================================

-- ---------- template_item_supplier_mappings ----------
CREATE TABLE IF NOT EXISTS public.template_item_supplier_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT public.get_user_tenant_id(),
  template_item_id UUID NOT NULL REFERENCES public.template_items(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL CHECK (supplier IN ('abc','srs','qxo')),
  supplier_item_code TEXT NOT NULL,
  supplier_description TEXT,
  uom TEXT,
  color_name TEXT,
  confidence NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  match_source TEXT NOT NULL DEFAULT 'auto' CHECK (match_source IN ('auto','manual','imported')),
  review_state TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_state IN ('unreviewed','approved','rejected','needs_attention')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT template_item_supplier_mappings_unique UNIQUE (tenant_id, template_item_id, supplier)
);

CREATE INDEX IF NOT EXISTS idx_tism_tenant_item
  ON public.template_item_supplier_mappings (tenant_id, template_item_id);
CREATE INDEX IF NOT EXISTS idx_tism_tenant_supplier_review
  ON public.template_item_supplier_mappings (tenant_id, supplier, review_state);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_item_supplier_mappings TO authenticated;
GRANT ALL ON public.template_item_supplier_mappings TO service_role;

ALTER TABLE public.template_item_supplier_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tism_select_own_tenant"
  ON public.template_item_supplier_mappings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "tism_insert_own_tenant"
  ON public.template_item_supplier_mappings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "tism_update_own_tenant"
  ON public.template_item_supplier_mappings FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "tism_delete_own_tenant"
  ON public.template_item_supplier_mappings FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE OR REPLACE FUNCTION public.tism_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_tism_updated_at ON public.template_item_supplier_mappings;
CREATE TRIGGER trg_tism_updated_at
  BEFORE UPDATE ON public.template_item_supplier_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tism_set_updated_at();


-- ---------- supplier_price_observations ----------
CREATE TABLE IF NOT EXISTS public.supplier_price_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT public.get_user_tenant_id(),
  mapping_id UUID REFERENCES public.template_item_supplier_mappings(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL CHECK (supplier IN ('abc','srs','qxo')),
  supplier_item_code TEXT NOT NULL,
  ship_to_number TEXT,
  branch_number TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('estimating','quoting','ordering')),
  uom TEXT,
  unit_price NUMERIC(12,4),
  currency TEXT NOT NULL DEFAULT 'USD',
  price_pending BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spo_tenant_mapping_observed
  ON public.supplier_price_observations (tenant_id, mapping_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_spo_tenant_supplier_observed
  ON public.supplier_price_observations (tenant_id, supplier, observed_at DESC);

GRANT SELECT, INSERT ON public.supplier_price_observations TO authenticated;
GRANT ALL ON public.supplier_price_observations TO service_role;

ALTER TABLE public.supplier_price_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spo_select_own_tenant"
  ON public.supplier_price_observations FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "spo_insert_own_tenant"
  ON public.supplier_price_observations FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- Blueprint Importer v2 — Phase 7.6a — Catalog binding schema.
-- Additive ONLY. Does NOT alter product_catalog / labor_rates /
-- supplier_catalog_items / abc_catalog_items / material_item_match_rules.
-- No runtime resolver, no pricing preflight, no live estimate writes.
-- =====================================================================

-- A. blueprint_catalog_bindings
CREATE TABLE IF NOT EXISTS public.blueprint_catalog_bindings (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       UUID NOT NULL,
  binding_scope                   TEXT NOT NULL DEFAULT 'tenant',
  binding_type                    TEXT NOT NULL,
  trade_id                        TEXT NOT NULL,
  source_candidate_type           TEXT NOT NULL,
  source_item_key                 TEXT NOT NULL,
  source_item_name                TEXT,
  source_template_key             TEXT,
  source_template_version         TEXT,
  source_formula_key              TEXT,
  source_unit                     TEXT NOT NULL,
  target_kind                     TEXT NOT NULL DEFAULT 'unresolved',
  target_table                    TEXT,
  target_item_id                  UUID,
  target_abc_item_number          TEXT,
  target_unit                     TEXT,
  unit_conversion_rule            JSONB NOT NULL DEFAULT '{}'::jsonb,
  pricing_source_type             TEXT NOT NULL DEFAULT 'unresolved',
  cost_source_type                TEXT NOT NULL DEFAULT 'unresolved',
  unit_cost                       NUMERIC,
  labor_rate_id                   UUID,
  markup_rule_id                  UUID,
  tax_rule_id                     UUID,
  effective_from                  TIMESTAMPTZ,
  effective_to                    TIMESTAMPTZ,
  status                          TEXT NOT NULL DEFAULT 'draft',
  resolver_priority               INTEGER NOT NULL DEFAULT 100,
  match_confidence                NUMERIC NOT NULL DEFAULT 1.0,
  requires_user_confirmation      BOOLEAN NOT NULL DEFAULT false,
  approved_by                     UUID,
  approved_at                     TIMESTAMPTZ,
  deterministic_binding_key       TEXT NOT NULL,
  metadata                        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_cat_bind_scope_chk CHECK (
    binding_scope IN ('tenant','template','trade','global_fallback_disabled')
  ),
  CONSTRAINT bp_cat_bind_type_chk CHECK (
    binding_type IN ('material','labor','accessory','allowance')
  ),
  CONSTRAINT bp_cat_bind_src_type_chk CHECK (
    source_candidate_type IN ('material','labor')
  ),
  CONSTRAINT bp_cat_bind_target_kind_chk CHECK (
    target_kind IN ('product_catalog','supplier_catalog_item','abc_catalog_item',
                    'labor_rate','custom_line_disabled','unresolved')
  ),
  CONSTRAINT bp_cat_bind_target_table_chk CHECK (
    target_table IS NULL OR target_table IN
    ('product_catalog','supplier_catalog_items','abc_catalog_items','labor_rates')
  ),
  CONSTRAINT bp_cat_bind_status_chk CHECK (
    status IN ('draft','active','inactive','superseded','blocked','needs_review')
  ),
  CONSTRAINT bp_cat_bind_pricing_source_chk CHECK (
    pricing_source_type IN ('catalog_cost','labor_rate','manual_approved','unresolved','disabled')
  ),
  CONSTRAINT bp_cat_bind_cost_source_chk CHECK (
    cost_source_type IN ('catalog','labor_rate','fixed','unresolved','disabled')
  ),
  CONSTRAINT bp_cat_bind_no_windows_doors CHECK (trade_id <> 'windows_doors'),
  CONSTRAINT bp_cat_bind_match_conf_range CHECK (match_confidence >= 0 AND match_confidence <= 1),
  CONSTRAINT bp_cat_bind_unique_key UNIQUE (tenant_id, deterministic_binding_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_catalog_bindings TO authenticated;
GRANT ALL ON public.blueprint_catalog_bindings TO service_role;

ALTER TABLE public.blueprint_catalog_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bp_catalog_bindings tenant all" ON public.blueprint_catalog_bindings
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_tenant ON public.blueprint_catalog_bindings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_trade ON public.blueprint_catalog_bindings(trade_id);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_item_key ON public.blueprint_catalog_bindings(source_item_key);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_src_type ON public.blueprint_catalog_bindings(source_candidate_type);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_template ON public.blueprint_catalog_bindings(source_template_key);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_target_kind ON public.blueprint_catalog_bindings(target_kind);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_target_item ON public.blueprint_catalog_bindings(target_item_id);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_labor_rate ON public.blueprint_catalog_bindings(labor_rate_id);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_status ON public.blueprint_catalog_bindings(status);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_dkey ON public.blueprint_catalog_bindings(deterministic_binding_key);

-- B. blueprint_catalog_binding_events (audit trail)
CREATE TABLE IF NOT EXISTS public.blueprint_catalog_binding_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  binding_id          UUID NOT NULL REFERENCES public.blueprint_catalog_bindings(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL,
  previous_status     TEXT,
  next_status         TEXT,
  changed_by          UUID,
  reason              TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_cat_bind_evt_type_chk CHECK (
    event_type IN ('created','status_changed','target_changed','pricing_changed',
                   'approved','superseded','deactivated','reactivated','blocked','note')
  )
);

GRANT SELECT, INSERT ON public.blueprint_catalog_binding_events TO authenticated;
GRANT ALL ON public.blueprint_catalog_binding_events TO service_role;

ALTER TABLE public.blueprint_catalog_binding_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bp_catalog_binding_events tenant select" ON public.blueprint_catalog_binding_events
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "bp_catalog_binding_events tenant insert" ON public.blueprint_catalog_binding_events
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_evt_tenant ON public.blueprint_catalog_binding_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_evt_binding ON public.blueprint_catalog_binding_events(binding_id);
CREATE INDEX IF NOT EXISTS idx_bp_cat_bind_evt_type ON public.blueprint_catalog_binding_events(event_type);

-- updated_at trigger for bindings
DROP TRIGGER IF EXISTS bp_catalog_bindings_updated_at ON public.blueprint_catalog_bindings;
CREATE TRIGGER bp_catalog_bindings_updated_at BEFORE UPDATE ON public.blueprint_catalog_bindings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
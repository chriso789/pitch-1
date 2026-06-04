-- =====================================================================
-- Blueprint Importer v2 — Phase 1 schema (promoted from
-- docs/migrations-draft/blueprint-importer-v2-phase1.sql)
-- Schema only. No runtime wiring.
-- =====================================================================

-- A. blueprint_import_sessions
CREATE TABLE IF NOT EXISTS public.blueprint_import_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  source_context_type TEXT NOT NULL,
  source_context_id   UUID,
  status              TEXT NOT NULL DEFAULT 'draft',
  contract_version    TEXT NOT NULL DEFAULT 'blueprint-importer-v2',
  deterministic_hash  TEXT,
  notes               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT blueprint_import_sessions_status_chk CHECK (
    status IN ('draft','parsed','trades_detected','user_review_required','accepted','rejected','superseded','failed')
  ),
  CONSTRAINT blueprint_import_sessions_context_type_chk CHECK (
    source_context_type IN ('project','opportunity','lead','estimate','contact','standalone')
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_import_sessions TO authenticated;
GRANT ALL ON public.blueprint_import_sessions TO service_role;
ALTER TABLE public.blueprint_import_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_import_sessions tenant read" ON public.blueprint_import_sessions FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "blueprint_import_sessions tenant insert" ON public.blueprint_import_sessions FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "blueprint_import_sessions tenant update" ON public.blueprint_import_sessions FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "blueprint_import_sessions tenant delete" ON public.blueprint_import_sessions FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_sessions_tenant ON public.blueprint_import_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bp_sessions_context ON public.blueprint_import_sessions(source_context_type, source_context_id);
CREATE INDEX IF NOT EXISTS idx_bp_sessions_status ON public.blueprint_import_sessions(status);

-- B. blueprint_source_documents
CREATE TABLE IF NOT EXISTS public.blueprint_source_documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id   UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL,
  file_id             UUID,
  storage_path        TEXT,
  document_reference  TEXT,
  document_type       TEXT NOT NULL,
  provider            TEXT NOT NULL,
  original_filename   TEXT,
  page_count          INTEGER,
  report_date         DATE,
  property_address    TEXT,
  property_latitude   DOUBLE PRECISION,
  property_longitude  DOUBLE PRECISION,
  content_hash        TEXT,
  extraction_status   TEXT NOT NULL DEFAULT 'pending',
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_src_doc_type_chk CHECK (document_type IN ('roof_report','wall_report','blueprint_set','spec_book','addendum','unknown')),
  CONSTRAINT bp_src_provider_chk CHECK (provider IN ('roofr','eagleview','internal_geometry','user_uploaded_blueprint','unknown')),
  CONSTRAINT bp_src_extraction_status_chk CHECK (extraction_status IN ('pending','in_progress','succeeded','failed','skipped'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_source_documents TO authenticated;
GRANT ALL ON public.blueprint_source_documents TO service_role;
ALTER TABLE public.blueprint_source_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_source_documents tenant all" ON public.blueprint_source_documents FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_src_session ON public.blueprint_source_documents(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_src_tenant ON public.blueprint_source_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bp_src_type_provider ON public.blueprint_source_documents(document_type, provider);

-- C. blueprint_detected_trades
CREATE TABLE IF NOT EXISTS public.blueprint_detected_trades (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id   UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL,
  trade_id            TEXT NOT NULL,
  support_status      TEXT NOT NULL,
  confidence          NUMERIC(4,3) NOT NULL DEFAULT 0,
  detection_signals   JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_document_ids UUID[] NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'detected',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_det_support_chk CHECK (support_status IN ('mvp_supported','measurement_object_only','future_supported','unsupported')),
  CONSTRAINT bp_det_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT bp_det_status_chk CHECK (status IN ('detected','dismissed','superseded','promoted'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_detected_trades TO authenticated;
GRANT ALL ON public.blueprint_detected_trades TO service_role;
ALTER TABLE public.blueprint_detected_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_detected_trades tenant all" ON public.blueprint_detected_trades FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_det_session ON public.blueprint_detected_trades(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_det_trade ON public.blueprint_detected_trades(trade_id);

-- D. blueprint_accepted_trades
CREATE TABLE IF NOT EXISTS public.blueprint_accepted_trades (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id   UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL,
  detected_trade_id   UUID REFERENCES public.blueprint_detected_trades(id) ON DELETE SET NULL,
  trade_id            TEXT NOT NULL,
  accepted_by         UUID,
  accepted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              TEXT NOT NULL DEFAULT 'accepted',
  selected_template_id UUID,
  user_assumptions    JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_state        TEXT NOT NULL DEFAULT 'pending_review',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_acc_status_chk CHECK (status IN ('accepted','rejected','superseded')),
  CONSTRAINT bp_acc_review_state_chk CHECK (review_state IN ('pending_review','blocked','cleared','manual_only')),
  CONSTRAINT bp_acc_windows_doors_chk CHECK (trade_id <> 'windows_doors'),
  CONSTRAINT bp_acc_future_manual_only_chk CHECK (
    trade_id NOT IN ('drywall','framing','insulation','flooring','concrete','electrical','plumbing','hvac')
    OR review_state = 'manual_only'
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_accepted_trades TO authenticated;
GRANT ALL ON public.blueprint_accepted_trades TO service_role;
ALTER TABLE public.blueprint_accepted_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_accepted_trades tenant all" ON public.blueprint_accepted_trades FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_acc_session ON public.blueprint_accepted_trades(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_acc_trade ON public.blueprint_accepted_trades(trade_id);

-- F. blueprint_plan_paths (declared before measurement_objects FK)
CREATE TABLE IF NOT EXISTS public.blueprint_plan_paths (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id     UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL,
  source_document_id    UUID REFERENCES public.blueprint_source_documents(id) ON DELETE SET NULL,
  path_type             TEXT NOT NULL,
  file_name             TEXT,
  document_type         TEXT,
  provider              TEXT,
  page_number           INTEGER,
  section_label         TEXT,
  table_label           TEXT,
  diagram_label         TEXT,
  source_text_excerpt   TEXT,
  source_coordinates    JSONB,
  confidence            NUMERIC(4,3) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_pp_path_type_chk CHECK (path_type IN ('report_page','blueprint_sheet','spec_section','user_entry','derived')),
  CONSTRAINT bp_pp_confidence_chk CHECK (confidence >= 0 AND confidence <= 1)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_plan_paths TO authenticated;
GRANT ALL ON public.blueprint_plan_paths TO service_role;
ALTER TABLE public.blueprint_plan_paths ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_plan_paths tenant all" ON public.blueprint_plan_paths FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_pp_session ON public.blueprint_plan_paths(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_pp_source ON public.blueprint_plan_paths(source_document_id);

-- E. blueprint_measurement_objects
CREATE TABLE IF NOT EXISTS public.blueprint_measurement_objects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id   UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL,
  source_document_id  UUID REFERENCES public.blueprint_source_documents(id) ON DELETE SET NULL,
  trade_id            TEXT,
  measurement_key     TEXT NOT NULL,
  measurement_group   TEXT,
  quantity            NUMERIC,
  unit                TEXT,
  precision           NUMERIC,
  confidence          NUMERIC(4,3) NOT NULL DEFAULT 0,
  source_value_raw    TEXT,
  normalized_value    JSONB,
  plan_path_id        UUID REFERENCES public.blueprint_plan_paths(id) ON DELETE SET NULL,
  page_number         INTEGER,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_mo_confidence_chk CHECK (confidence >= 0 AND confidence <= 1)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_measurement_objects TO authenticated;
GRANT ALL ON public.blueprint_measurement_objects TO service_role;
ALTER TABLE public.blueprint_measurement_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_measurement_objects tenant all" ON public.blueprint_measurement_objects FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_mo_session ON public.blueprint_measurement_objects(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_mo_trade ON public.blueprint_measurement_objects(trade_id);
CREATE INDEX IF NOT EXISTS idx_bp_mo_key ON public.blueprint_measurement_objects(measurement_key);

-- G. blueprint_review_flags
CREATE TABLE IF NOT EXISTS public.blueprint_review_flags (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id     UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id             UUID NOT NULL,
  related_entity_type   TEXT NOT NULL,
  related_entity_id     UUID,
  severity              TEXT NOT NULL,
  flag_code             TEXT NOT NULL,
  message               TEXT NOT NULL,
  blocking              BOOLEAN NOT NULL DEFAULT false,
  resolved              BOOLEAN NOT NULL DEFAULT false,
  resolved_by           UUID,
  resolved_at           TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_rf_severity_chk CHECK (severity IN ('info','warning','error','blocker')),
  CONSTRAINT bp_rf_entity_type_chk CHECK (
    related_entity_type IN ('import_session','source_document','detected_trade','accepted_trade','measurement_object','template_binding','material_draft_line','labor_draft_line','plan_path')
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_review_flags TO authenticated;
GRANT ALL ON public.blueprint_review_flags TO service_role;
ALTER TABLE public.blueprint_review_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_review_flags tenant all" ON public.blueprint_review_flags FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_rf_session ON public.blueprint_review_flags(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_rf_entity ON public.blueprint_review_flags(related_entity_type, related_entity_id);
CREATE INDEX IF NOT EXISTS idx_bp_rf_blocking ON public.blueprint_review_flags(blocking) WHERE blocking = true AND resolved = false;

-- H. blueprint_template_bindings
CREATE TABLE IF NOT EXISTS public.blueprint_template_bindings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id   UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL,
  accepted_trade_id   UUID REFERENCES public.blueprint_accepted_trades(id) ON DELETE CASCADE,
  trade_id            TEXT NOT NULL,
  template_id         UUID,
  template_version    TEXT,
  binding_status      TEXT NOT NULL DEFAULT 'pending',
  required_inputs     JSONB NOT NULL DEFAULT '{}'::jsonb,
  optional_inputs     JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_inputs      JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_assumptions    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_tb_binding_status_chk CHECK (binding_status IN ('pending','ready','blocked','rejected','superseded'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_template_bindings TO authenticated;
GRANT ALL ON public.blueprint_template_bindings TO service_role;
ALTER TABLE public.blueprint_template_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_template_bindings tenant all" ON public.blueprint_template_bindings FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_tb_session ON public.blueprint_template_bindings(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_tb_accepted ON public.blueprint_template_bindings(accepted_trade_id);

-- I. blueprint_material_draft_lines (schema only — NOT populated in Phase 1)
CREATE TABLE IF NOT EXISTS public.blueprint_material_draft_lines (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id           UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id                   UUID NOT NULL,
  accepted_trade_id           UUID REFERENCES public.blueprint_accepted_trades(id) ON DELETE CASCADE,
  template_binding_id         UUID REFERENCES public.blueprint_template_bindings(id) ON DELETE SET NULL,
  material_rule_id            TEXT,
  item_key                    TEXT NOT NULL,
  item_name                   TEXT,
  quantity                    NUMERIC,
  unit                        TEXT,
  rounding_rule               TEXT,
  waste_percent               NUMERIC,
  source_measurement_ids      UUID[] NOT NULL DEFAULT '{}',
  plan_path_ids               UUID[] NOT NULL DEFAULT '{}',
  formula_key                 TEXT,
  formula_inputs              JSONB NOT NULL DEFAULT '{}'::jsonb,
  catalog_resolution_status   TEXT NOT NULL DEFAULT 'unresolved',
  catalog_item_id             UUID,
  status                      TEXT NOT NULL DEFAULT 'draft',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_mdl_catalog_status_chk CHECK (catalog_resolution_status IN ('unresolved','matched','ambiguous','missing','manual_override')),
  CONSTRAINT bp_mdl_status_chk CHECK (status IN ('draft','ready','blocked','rejected','superseded'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_material_draft_lines TO authenticated;
GRANT ALL ON public.blueprint_material_draft_lines TO service_role;
ALTER TABLE public.blueprint_material_draft_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_material_draft_lines tenant all" ON public.blueprint_material_draft_lines FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_mdl_session ON public.blueprint_material_draft_lines(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_mdl_accepted ON public.blueprint_material_draft_lines(accepted_trade_id);

-- J. blueprint_labor_draft_lines (schema only — NOT populated in Phase 1)
CREATE TABLE IF NOT EXISTS public.blueprint_labor_draft_lines (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id       UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id               UUID NOT NULL,
  accepted_trade_id       UUID REFERENCES public.blueprint_accepted_trades(id) ON DELETE CASCADE,
  template_binding_id     UUID REFERENCES public.blueprint_template_bindings(id) ON DELETE SET NULL,
  labor_rule_id           TEXT,
  labor_key               TEXT NOT NULL,
  labor_name              TEXT,
  quantity                NUMERIC,
  unit                    TEXT,
  base_rate               NUMERIC,
  complexity_multiplier   NUMERIC,
  source_measurement_ids  UUID[] NOT NULL DEFAULT '{}',
  plan_path_ids           UUID[] NOT NULL DEFAULT '{}',
  formula_key             TEXT,
  formula_inputs          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                  TEXT NOT NULL DEFAULT 'draft',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_ldl_status_chk CHECK (status IN ('draft','ready','blocked','rejected','superseded'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_labor_draft_lines TO authenticated;
GRANT ALL ON public.blueprint_labor_draft_lines TO service_role;
ALTER TABLE public.blueprint_labor_draft_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_labor_draft_lines tenant all" ON public.blueprint_labor_draft_lines FOR ALL TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_ldl_session ON public.blueprint_labor_draft_lines(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_ldl_accepted ON public.blueprint_labor_draft_lines(accepted_trade_id);

-- updated_at maintenance triggers
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'blueprint_import_sessions','blueprint_source_documents',
    'blueprint_detected_trades','blueprint_accepted_trades',
    'blueprint_template_bindings'
  ]) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON public.%I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();',
      t, t
    );
  END LOOP;
END$$;

NOTIFY pgrst, 'reload schema';

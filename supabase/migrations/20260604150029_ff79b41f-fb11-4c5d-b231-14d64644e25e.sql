-- =====================================================================
-- Blueprint Importer v2 — Phase 5.5 — CRM handoff staging surfaces.
-- Schema only. NOT runtime-wired. No live estimate writes.
--
-- Canonical CRM estimate header target: public.enhanced_estimates
-- Evidence: update-estimate-line-items + excel-style-estimate-calculator
-- both read/write enhanced_estimates; it carries tier/calculation_metadata/
-- measurement_report_id. Legacy public.estimates rejected for blueprint
-- handoff.
-- =====================================================================

-- A. blueprint_estimate_handoff_batches
CREATE TABLE IF NOT EXISTS public.blueprint_estimate_handoff_batches (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       UUID NOT NULL,
  import_session_id               UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  target_context_type             TEXT NOT NULL,
  target_context_id               UUID,
  canonical_estimate_target_table TEXT NOT NULL DEFAULT 'enhanced_estimates',
  canonical_estimate_target_id    UUID,
  status                          TEXT NOT NULL DEFAULT 'draft',
  pricing_mode                    TEXT NOT NULL DEFAULT 'quantity_only',
  catalog_mode                    TEXT NOT NULL DEFAULT 'preview_only',
  custom_line_mode                TEXT NOT NULL DEFAULT 'disabled',
  created_by                      UUID,
  approved_by                     UUID,
  approved_at                     TIMESTAMPTZ,
  deterministic_batch_key         TEXT NOT NULL,
  source_draft_hash               TEXT,
  blocking_review_flag_ids        UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  warning_review_flag_ids         UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  metadata                        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_handoff_batch_target_ctx_chk CHECK (
    target_context_type IN ('project','opportunity','lead','estimate','contact','standalone')
  ),
  CONSTRAINT bp_handoff_batch_target_table_chk CHECK (
    canonical_estimate_target_table IN ('enhanced_estimates')
  ),
  CONSTRAINT bp_handoff_batch_status_chk CHECK (
    status IN ('draft','preview_requested','preview_created','user_review_required',
               'user_approved_for_estimate','live_write_requested','live_written',
               'superseded','cancelled','failed')
  ),
  CONSTRAINT bp_handoff_batch_pricing_mode_chk CHECK (
    pricing_mode IN ('quantity_only','ready_for_pricing_review')
  ),
  CONSTRAINT bp_handoff_batch_catalog_mode_chk CHECK (
    catalog_mode IN ('catalog_resolved_only','user_approved_custom_lines','preview_only')
  ),
  CONSTRAINT bp_handoff_batch_custom_line_mode_chk CHECK (
    custom_line_mode IN ('disabled','enabled')
  ),
  CONSTRAINT bp_handoff_batch_unique_key UNIQUE (tenant_id, deterministic_batch_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_estimate_handoff_batches TO authenticated;
GRANT ALL ON public.blueprint_estimate_handoff_batches TO service_role;
ALTER TABLE public.blueprint_estimate_handoff_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bp_handoff_batches tenant all" ON public.blueprint_estimate_handoff_batches
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_handoff_batch_tenant ON public.blueprint_estimate_handoff_batches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bp_handoff_batch_session ON public.blueprint_estimate_handoff_batches(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_handoff_batch_status ON public.blueprint_estimate_handoff_batches(status);
CREATE INDEX IF NOT EXISTS idx_bp_handoff_batch_target_ctx ON public.blueprint_estimate_handoff_batches(target_context_type, target_context_id);
CREATE INDEX IF NOT EXISTS idx_bp_handoff_batch_target_id ON public.blueprint_estimate_handoff_batches(canonical_estimate_target_id);
CREATE INDEX IF NOT EXISTS idx_bp_handoff_batch_dkey ON public.blueprint_estimate_handoff_batches(deterministic_batch_key);

-- B. blueprint_estimate_line_candidates
CREATE TABLE IF NOT EXISTS public.blueprint_estimate_line_candidates (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID NOT NULL,
  handoff_batch_id            UUID NOT NULL REFERENCES public.blueprint_estimate_handoff_batches(id) ON DELETE CASCADE,
  import_session_id           UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  accepted_trade_id           UUID NOT NULL,
  template_binding_id         UUID,
  source_draft_line_id        UUID NOT NULL,
  source_draft_line_type      TEXT NOT NULL,
  trade_id                    TEXT NOT NULL,
  item_key                    TEXT NOT NULL,
  item_name                   TEXT,
  description                 TEXT,
  quantity                    NUMERIC,
  unit                        TEXT,
  source_measurement_ids      UUID[] NOT NULL,
  plan_path_ids               UUID[] NOT NULL,
  source_document_ids         UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  formula_key                 TEXT,
  formula_inputs              JSONB NOT NULL DEFAULT '{}'::jsonb,
  catalog_resolution_status   TEXT NOT NULL DEFAULT 'unresolved',
  catalog_item_id             UUID,
  pricing_status              TEXT NOT NULL DEFAULT 'quantity_only',
  cost_status                 TEXT NOT NULL DEFAULT 'not_attempted',
  user_review_status          TEXT NOT NULL DEFAULT 'pending',
  handoff_allowed             BOOLEAN NOT NULL DEFAULT false,
  handoff_blockers            JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocking_review_flag_ids    UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  warning_review_flag_ids     UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  deterministic_handoff_key   TEXT NOT NULL,
  provenance_summary          JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                      TEXT NOT NULL DEFAULT 'draft',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_line_cand_draft_type_chk CHECK (
    source_draft_line_type IN ('material','labor')
  ),
  CONSTRAINT bp_line_cand_catalog_status_chk CHECK (
    catalog_resolution_status IN ('unresolved','matched','ambiguous','missing','manual_override')
  ),
  CONSTRAINT bp_line_cand_pricing_status_chk CHECK (
    pricing_status IN (
      'quantity_only','cost_unresolved','catalog_resolved_cost_missing',
      'catalog_resolved_cost_available','labor_rate_missing',
      'ready_for_pricing_review','ready_for_live_handoff','blocked'
    )
  ),
  CONSTRAINT bp_line_cand_cost_status_chk CHECK (
    cost_status IN ('not_attempted','unavailable','available_from_catalog','available_from_user_override')
  ),
  CONSTRAINT bp_line_cand_user_review_chk CHECK (
    user_review_status IN ('pending','reviewed','approved','excluded')
  ),
  CONSTRAINT bp_line_cand_status_chk CHECK (
    status IN ('draft','preview','blocked','user_review_required','user_approved',
               'superseded','cancelled','failed','live_written')
  ),
  CONSTRAINT bp_line_cand_trade_not_windows_doors CHECK (trade_id <> 'windows_doors'),
  CONSTRAINT bp_line_cand_plan_path_nonempty CHECK (array_length(plan_path_ids, 1) >= 1),
  CONSTRAINT bp_line_cand_measurements_nonempty CHECK (array_length(source_measurement_ids, 1) >= 1),
  CONSTRAINT bp_line_cand_unique_key UNIQUE (tenant_id, deterministic_handoff_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_estimate_line_candidates TO authenticated;
GRANT ALL ON public.blueprint_estimate_line_candidates TO service_role;
ALTER TABLE public.blueprint_estimate_line_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bp_line_candidates tenant all" ON public.blueprint_estimate_line_candidates
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_line_cand_tenant ON public.blueprint_estimate_line_candidates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bp_line_cand_batch ON public.blueprint_estimate_line_candidates(handoff_batch_id);
CREATE INDEX IF NOT EXISTS idx_bp_line_cand_session ON public.blueprint_estimate_line_candidates(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_line_cand_draft ON public.blueprint_estimate_line_candidates(source_draft_line_type, source_draft_line_id);
CREATE INDEX IF NOT EXISTS idx_bp_line_cand_status ON public.blueprint_estimate_line_candidates(status);
CREATE INDEX IF NOT EXISTS idx_bp_line_cand_dkey ON public.blueprint_estimate_line_candidates(deterministic_handoff_key);

-- C. blueprint_estimate_line_provenance (bridge — chosen over altering estimate_line_items)
CREATE TABLE IF NOT EXISTS public.blueprint_estimate_line_provenance (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       UUID NOT NULL,
  handoff_batch_id                UUID NOT NULL REFERENCES public.blueprint_estimate_handoff_batches(id) ON DELETE CASCADE,
  line_candidate_id               UUID NOT NULL REFERENCES public.blueprint_estimate_line_candidates(id) ON DELETE CASCADE,
  canonical_estimate_target_table TEXT NOT NULL DEFAULT 'enhanced_estimates',
  canonical_estimate_target_id    UUID,
  live_estimate_line_item_id      UUID,
  deterministic_handoff_key       TEXT NOT NULL,
  import_session_id               UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  accepted_trade_id               UUID NOT NULL,
  template_binding_id             UUID,
  source_draft_line_id            UUID NOT NULL,
  source_draft_line_type          TEXT NOT NULL,
  source_measurement_ids          UUID[] NOT NULL,
  plan_path_ids                   UUID[] NOT NULL,
  source_document_ids             UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  formula_key                     TEXT,
  formula_inputs                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by                     UUID,
  approved_at                     TIMESTAMPTZ,
  live_written_by                 UUID,
  live_written_at                 TIMESTAMPTZ,
  metadata                        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_line_prov_target_table_chk CHECK (
    canonical_estimate_target_table IN ('enhanced_estimates')
  ),
  CONSTRAINT bp_line_prov_draft_type_chk CHECK (
    source_draft_line_type IN ('material','labor')
  ),
  CONSTRAINT bp_line_prov_plan_path_nonempty CHECK (array_length(plan_path_ids, 1) >= 1),
  CONSTRAINT bp_line_prov_measurements_nonempty CHECK (array_length(source_measurement_ids, 1) >= 1),
  CONSTRAINT bp_line_prov_unique_key UNIQUE (tenant_id, deterministic_handoff_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_estimate_line_provenance TO authenticated;
GRANT ALL ON public.blueprint_estimate_line_provenance TO service_role;
ALTER TABLE public.blueprint_estimate_line_provenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bp_line_provenance tenant all" ON public.blueprint_estimate_line_provenance
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_line_prov_tenant ON public.blueprint_estimate_line_provenance(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bp_line_prov_batch ON public.blueprint_estimate_line_provenance(handoff_batch_id);
CREATE INDEX IF NOT EXISTS idx_bp_line_prov_candidate ON public.blueprint_estimate_line_provenance(line_candidate_id);
CREATE INDEX IF NOT EXISTS idx_bp_line_prov_session ON public.blueprint_estimate_line_provenance(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_line_prov_target_id ON public.blueprint_estimate_line_provenance(canonical_estimate_target_id);
CREATE INDEX IF NOT EXISTS idx_bp_line_prov_live_line ON public.blueprint_estimate_line_provenance(live_estimate_line_item_id);
CREATE INDEX IF NOT EXISTS idx_bp_line_prov_dkey ON public.blueprint_estimate_line_provenance(deterministic_handoff_key);

-- updated_at triggers (reuse existing public.update_updated_at_column if present;
-- fall back to inline definition pattern used elsewhere in this repo).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $f$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $f$ LANGUAGE plpgsql SET search_path = public;
  END IF;
END$$;

DROP TRIGGER IF EXISTS bp_handoff_batches_updated_at ON public.blueprint_estimate_handoff_batches;
CREATE TRIGGER bp_handoff_batches_updated_at BEFORE UPDATE ON public.blueprint_estimate_handoff_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS bp_line_candidates_updated_at ON public.blueprint_estimate_line_candidates;
CREATE TRIGGER bp_line_candidates_updated_at BEFORE UPDATE ON public.blueprint_estimate_line_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS bp_line_provenance_updated_at ON public.blueprint_estimate_line_provenance;
CREATE TRIGGER bp_line_provenance_updated_at BEFORE UPDATE ON public.blueprint_estimate_line_provenance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Section-Aware Measurement Mapping — Phase 1 foundation
-- ============================================================
-- Adds normalized measurement segments/features + template
-- applicability rules + estimate mapping assignment audit table.
-- All tables are tenant-scoped with RLS via get_user_tenant_id().
-- Legacy code paths are unaffected; opt-in via
-- estimate_calculation_templates.use_section_mapping.

-- 1. measurement_imports — one row per provider import batch
CREATE TABLE IF NOT EXISTS public.measurement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  roof_measurement_id UUID REFERENCES public.roof_measurements(id) ON DELETE CASCADE,
  job_id UUID,
  provider TEXT NOT NULL DEFAULT 'unknown',
  source_doc_id TEXT,
  source_fingerprint TEXT,
  import_status TEXT NOT NULL DEFAULT 'normalized'
    CHECK (import_status IN ('pending','normalized','classified','manual_split','archived','failed')),
  quality_score NUMERIC,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurement_imports TO authenticated;
GRANT ALL ON public.measurement_imports TO service_role;
ALTER TABLE public.measurement_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "measurement_imports tenant select"
  ON public.measurement_imports FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "measurement_imports tenant insert"
  ON public.measurement_imports FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "measurement_imports tenant update"
  ON public.measurement_imports FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "measurement_imports tenant delete"
  ON public.measurement_imports FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_measurement_imports_tenant ON public.measurement_imports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_measurement_imports_roof_measurement ON public.measurement_imports(roof_measurement_id);
CREATE INDEX IF NOT EXISTS idx_measurement_imports_job ON public.measurement_imports(job_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_measurement_imports_fingerprint
  ON public.measurement_imports(tenant_id, source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;

-- 2. measurement_segments — surface planes (flat / low_slope / sloped / other / unknown)
CREATE TABLE IF NOT EXISTS public.measurement_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  measurement_import_id UUID NOT NULL REFERENCES public.measurement_imports(id) ON DELETE CASCADE,
  provider_segment_key TEXT,
  name TEXT,
  geometry_geojson JSONB,
  area_sqft NUMERIC,
  pitch_rise_over_12 NUMERIC,
  pitch_scope TEXT NOT NULL DEFAULT 'none'
    CHECK (pitch_scope IN ('segment','global','none')),
  surface_class TEXT NOT NULL DEFAULT 'unknown'
    CHECK (surface_class IN ('flat','low_slope','sloped','other','unknown')),
  classification_confidence NUMERIC NOT NULL DEFAULT 0,
  classification_reason TEXT,
  is_synthetic_split BOOLEAN NOT NULL DEFAULT false,
  is_split_residual BOOLEAN NOT NULL DEFAULT false,
  reviewed BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  parent_segment_id UUID REFERENCES public.measurement_segments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurement_segments TO authenticated;
GRANT ALL ON public.measurement_segments TO service_role;
ALTER TABLE public.measurement_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "measurement_segments tenant select"
  ON public.measurement_segments FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "measurement_segments tenant insert"
  ON public.measurement_segments FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "measurement_segments tenant update"
  ON public.measurement_segments FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "measurement_segments tenant delete"
  ON public.measurement_segments FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_meas_segments_tenant ON public.measurement_segments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_meas_segments_import_class
  ON public.measurement_segments(measurement_import_id, surface_class)
  WHERE archived_at IS NULL;

-- 3. measurement_features — linear/count features
CREATE TABLE IF NOT EXISTS public.measurement_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  measurement_import_id UUID NOT NULL REFERENCES public.measurement_imports(id) ON DELETE CASCADE,
  provider_feature_key TEXT,
  feature_type TEXT NOT NULL
    CHECK (feature_type IN (
      'ridge','hip','valley','eave','rake','drip_edge',
      'step_flashing','wall_flashing','parapet','gutter','downspout',
      'drain','pipe_boot','vent','skylight','chimney','other'
    )),
  geometry_geojson JSONB,
  length_ft NUMERIC,
  count_value INTEGER,
  primary_segment_id UUID REFERENCES public.measurement_segments(id) ON DELETE SET NULL,
  confidence NUMERIC NOT NULL DEFAULT 0,
  reviewed BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurement_features TO authenticated;
GRANT ALL ON public.measurement_features TO service_role;
ALTER TABLE public.measurement_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "measurement_features tenant select"
  ON public.measurement_features FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "measurement_features tenant insert"
  ON public.measurement_features FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "measurement_features tenant update"
  ON public.measurement_features FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "measurement_features tenant delete"
  ON public.measurement_features FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_meas_features_tenant ON public.measurement_features(tenant_id);
CREATE INDEX IF NOT EXISTS idx_meas_features_import_type
  ON public.measurement_features(measurement_import_id, feature_type)
  WHERE archived_at IS NULL;

-- 4. template_section_rules — applicability of a calc-template group
CREATE TABLE IF NOT EXISTS public.template_section_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  group_id UUID NOT NULL REFERENCES public.estimate_calc_template_groups(id) ON DELETE CASCADE,
  surface_classes TEXT[] NOT NULL DEFAULT '{}',
  feature_types TEXT[] NOT NULL DEFAULT '{}',
  min_pitch NUMERIC,
  max_pitch NUMERIC,
  allow_unknown BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_section_rules TO authenticated;
GRANT ALL ON public.template_section_rules TO service_role;
ALTER TABLE public.template_section_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "template_section_rules tenant select"
  ON public.template_section_rules FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "template_section_rules tenant insert"
  ON public.template_section_rules FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "template_section_rules tenant update"
  ON public.template_section_rules FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "template_section_rules tenant delete"
  ON public.template_section_rules FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_template_section_rules_tenant ON public.template_section_rules(tenant_id);

-- 5. template_item_rules — applicability of a calc-template item
CREATE TABLE IF NOT EXISTS public.template_item_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL REFERENCES public.estimate_calc_template_items(id) ON DELETE CASCADE,
  surface_classes TEXT[] NOT NULL DEFAULT '{}',
  feature_types TEXT[] NOT NULL DEFAULT '{}',
  measurement_scope TEXT NOT NULL DEFAULT 'global'
    CHECK (measurement_scope IN ('global','class','section')),
  allow_global_fallback BOOLEAN NOT NULL DEFAULT true,
  allow_unknown BOOLEAN NOT NULL DEFAULT false,
  exclusive_group TEXT,
  min_confidence NUMERIC NOT NULL DEFAULT 0.7,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_item_rules TO authenticated;
GRANT ALL ON public.template_item_rules TO service_role;
ALTER TABLE public.template_item_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "template_item_rules tenant select"
  ON public.template_item_rules FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "template_item_rules tenant insert"
  ON public.template_item_rules FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "template_item_rules tenant update"
  ON public.template_item_rules FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "template_item_rules tenant delete"
  ON public.template_item_rules FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_template_item_rules_tenant ON public.template_item_rules(tenant_id);

-- 6. estimate_measurement_assignments — auditable mapping result
CREATE TABLE IF NOT EXISTS public.estimate_measurement_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  estimate_id UUID,
  measurement_import_id UUID NOT NULL REFERENCES public.measurement_imports(id) ON DELETE CASCADE,
  calc_template_id UUID REFERENCES public.estimate_calculation_templates(id) ON DELETE SET NULL,
  template_group_id UUID REFERENCES public.estimate_calc_template_groups(id) ON DELETE SET NULL,
  template_item_id UUID REFERENCES public.estimate_calc_template_items(id) ON DELETE SET NULL,
  segment_ids UUID[] NOT NULL DEFAULT '{}',
  feature_ids UUID[] NOT NULL DEFAULT '{}',
  quantity NUMERIC,
  unit TEXT,
  formula_evaluated TEXT,
  confidence NUMERIC,
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned','unresolved','conflict','manual','skipped')),
  reason_code TEXT,
  matched_by JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_dry_run BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_measurement_assignments TO authenticated;
GRANT ALL ON public.estimate_measurement_assignments TO service_role;
ALTER TABLE public.estimate_measurement_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ema tenant select"
  ON public.estimate_measurement_assignments FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ema tenant insert"
  ON public.estimate_measurement_assignments FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ema tenant update"
  ON public.estimate_measurement_assignments FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "ema tenant delete"
  ON public.estimate_measurement_assignments FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_ema_tenant ON public.estimate_measurement_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ema_estimate_status ON public.estimate_measurement_assignments(estimate_id, status);
CREATE INDEX IF NOT EXISTS idx_ema_import ON public.estimate_measurement_assignments(measurement_import_id);

-- 7. Opt-in flag on the calc template (compatibility mode is default OFF)
ALTER TABLE public.estimate_calculation_templates
  ADD COLUMN IF NOT EXISTS use_section_mapping BOOLEAN NOT NULL DEFAULT false;

-- 8. updated_at triggers reusing the existing helper
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    PERFORM 1;
  ELSE
    CREATE OR REPLACE FUNCTION public.update_updated_at_column()
    RETURNS TRIGGER AS $f$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $f$
    LANGUAGE plpgsql SET search_path = public;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_measurement_imports_updated_at ON public.measurement_imports;
CREATE TRIGGER trg_measurement_imports_updated_at BEFORE UPDATE ON public.measurement_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_measurement_segments_updated_at ON public.measurement_segments;
CREATE TRIGGER trg_measurement_segments_updated_at BEFORE UPDATE ON public.measurement_segments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_measurement_features_updated_at ON public.measurement_features;
CREATE TRIGGER trg_measurement_features_updated_at BEFORE UPDATE ON public.measurement_features
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_template_section_rules_updated_at ON public.template_section_rules;
CREATE TRIGGER trg_template_section_rules_updated_at BEFORE UPDATE ON public.template_section_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_template_item_rules_updated_at ON public.template_item_rules;
CREATE TRIGGER trg_template_item_rules_updated_at BEFORE UPDATE ON public.template_item_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ema_updated_at ON public.estimate_measurement_assignments;
CREATE TRIGGER trg_ema_updated_at BEFORE UPDATE ON public.estimate_measurement_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Refresh PostgREST schema cache so new tables are reachable immediately
NOTIFY pgrst, 'reload schema';

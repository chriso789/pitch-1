
CREATE TABLE IF NOT EXISTS public.measurement_learning_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID,
  tenant_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'vendor_truth_diff','manager_correction','field_correction',
    'gate_failure','auto_ship','manual_override'
  )),
  source TEXT,
  gate_decision TEXT,
  per_class_errors JSONB,
  area_error_pct NUMERIC,
  pitch_error_deg NUMERIC,
  ridge_error_pct NUMERIC,
  hip_error_pct NUMERIC,
  valley_error_pct NUMERIC,
  eave_error_pct NUMERIC,
  rake_error_pct NUMERIC,
  weighted_score NUMERIC,
  payload JSONB,
  used_for_training BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mle_measurement ON public.measurement_learning_events(measurement_id);
CREATE INDEX IF NOT EXISTS idx_mle_tenant ON public.measurement_learning_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mle_event_type ON public.measurement_learning_events(event_type);
CREATE INDEX IF NOT EXISTS idx_mle_created ON public.measurement_learning_events(created_at DESC);

ALTER TABLE public.measurement_learning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mle_tenant_select" ON public.measurement_learning_events
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id IN (SELECT tid FROM public.get_user_tenant_ids()));

CREATE POLICY "mle_tenant_insert" ON public.measurement_learning_events
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NULL OR tenant_id IN (SELECT tid FROM public.get_user_tenant_ids()));

CREATE POLICY "mle_master_all" ON public.measurement_learning_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'))
  WITH CHECK (public.has_role(auth.uid(), 'master'));

CREATE TABLE IF NOT EXISTS public.measurement_accuracy_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_measurements INTEGER NOT NULL DEFAULT 0,
  auto_ship_count INTEGER NOT NULL DEFAULT 0,
  review_required_count INTEGER NOT NULL DEFAULT 0,
  reject_count INTEGER NOT NULL DEFAULT 0,
  auto_ship_rate NUMERIC,
  avg_area_error_pct NUMERIC,
  avg_pitch_error_deg NUMERIC,
  avg_ridge_error_pct NUMERIC,
  avg_eave_error_pct NUMERIC,
  per_class_pass_rates JSONB,
  algorithm_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, snapshot_date, algorithm_version)
);

ALTER TABLE public.measurement_accuracy_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mas_tenant_select" ON public.measurement_accuracy_snapshots
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id IN (SELECT tid FROM public.get_user_tenant_ids()));

CREATE POLICY "mas_master_all" ON public.measurement_accuracy_snapshots
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'master'))
  WITH CHECK (public.has_role(auth.uid(), 'master'));

-- PR #5 — Self-Consistent Pitch Verification
-- Runtime confidence is derived from raw evidence agreement only.

ALTER TABLE IF EXISTS public.roof_measurements
  ADD COLUMN IF NOT EXISTS pitch_verification_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pitch_self_consistency_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pitch_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS visual_pitch_delta_rise_per_12 DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pitch_verification_source TEXT;

ALTER TABLE IF EXISTS public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS pitch_verification_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pitch_self_consistency_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pitch_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS visual_pitch_delta_rise_per_12 DOUBLE PRECISION;

ALTER TABLE IF EXISTS public.measurement_jobs
  ADD COLUMN IF NOT EXISTS pitch_verification_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pitch_self_consistency_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pitch_verification_status TEXT;

ALTER TABLE IF EXISTS public.mskill_geometry_status
  ADD COLUMN IF NOT EXISTS pitch_self_consistency_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pitch_self_consistency_status TEXT,
  ADD COLUMN IF NOT EXISTS pitch_verification_json JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.pitch_visual_cross_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_request_id UUID,
  mskill_job_id UUID,
  measurement_job_id UUID,
  roof_measurement_id UUID,
  request_hash TEXT,
  facet_id TEXT,
  imagery_provider TEXT,
  imagery_status TEXT,
  imagery_reference_id TEXT,
  imagery_date TEXT,
  heading_deg DOUBLE PRECISION,
  camera_pitch_deg DOUBLE PRECISION,
  edge_angle_deg DOUBLE PRECISION,
  estimated_pitch_rise_over_12 DOUBLE PRECISION,
  reference_pitch_rise_over_12 DOUBLE PRECISION,
  delta_rise_over_12 DOUBLE PRECISION,
  confidence DOUBLE PRECISION,
  analysis_status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pitch_visual_cross_checks_tenant_created
  ON public.pitch_visual_cross_checks(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pitch_visual_cross_checks_mskill_job
  ON public.pitch_visual_cross_checks(mskill_job_id);
CREATE INDEX IF NOT EXISTS idx_pitch_visual_cross_checks_roof_measurement
  ON public.pitch_visual_cross_checks(roof_measurement_id);

GRANT SELECT, INSERT, UPDATE ON public.pitch_visual_cross_checks TO authenticated;
GRANT ALL ON public.pitch_visual_cross_checks TO service_role;
ALTER TABLE public.pitch_visual_cross_checks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pitch_visual_cross_checks'
      AND policyname = 'pitch_visual_cross_checks_tenant_all'
  ) THEN
    CREATE POLICY "pitch_visual_cross_checks_tenant_all"
      ON public.pitch_visual_cross_checks
      FOR ALL TO authenticated
      USING (tenant_id IN (
        SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()
      ))
      WITH CHECK (tenant_id IN (
        SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()
      ));
  END IF;
END $$;

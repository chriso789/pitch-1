
-- PR #5: Self-consistent pitch verification
-- Adds per-facet pitch evidence columns (DSM / Solar / Street View) plus job-level rollup.

-- 1. Per-facet pitch evidence
ALTER TABLE public.roof_measurement_facets
  ADD COLUMN IF NOT EXISTS pitch_dsm_deg numeric,
  ADD COLUMN IF NOT EXISTS pitch_solar_deg numeric,
  ADD COLUMN IF NOT EXISTS pitch_streetview_deg numeric,
  ADD COLUMN IF NOT EXISTS pitch_agreement_state text,
  ADD COLUMN IF NOT EXISTS pitch_source_final text,
  ADD COLUMN IF NOT EXISTS pitch_consensus_deg numeric,
  ADD COLUMN IF NOT EXISTS pitch_verification_json jsonb;

-- 2. Job-level rollup (best-effort, only if tables exist with the expected shape)
ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS pitch_verification_json jsonb;

ALTER TABLE public.measurement_jobs
  ADD COLUMN IF NOT EXISTS pitch_verification_json jsonb;

-- 3. Reload PostgREST schema cache so the new columns are immediately usable.
NOTIFY pgrst, 'reload schema';

-- PR #5 self-consistent pitch verification schema
ALTER TABLE IF EXISTS public.roof_measurements
  ADD COLUMN IF NOT EXISTS pitch_verification_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pitch_self_consistency_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pitch_verification_status TEXT;

ALTER TABLE roof_training_sessions
  ADD COLUMN IF NOT EXISTS verification_verdict text,
  ADD COLUMN IF NOT EXISTS verification_score numeric,
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS verification_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_feature_breakdown jsonb;
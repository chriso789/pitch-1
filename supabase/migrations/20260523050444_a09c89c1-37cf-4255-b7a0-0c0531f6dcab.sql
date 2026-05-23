
ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS user_verified_perimeter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS user_verified_perimeter_at timestamptz,
  ADD COLUMN IF NOT EXISTS user_verified_perimeter_by uuid,
  ADD COLUMN IF NOT EXISTS perimeter_visual_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS perimeter_source_locked text;

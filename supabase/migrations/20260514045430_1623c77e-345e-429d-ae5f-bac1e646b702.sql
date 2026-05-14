
ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS verified_by_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS report_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

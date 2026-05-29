-- Phase 1.6: staging backfill provenance + soft-void fields.
-- Adds columns the staging backfill / rollback / shadow scripts depend on.
-- Production rows existing today get NULLs (no backfill, not voided).

ALTER TABLE public.measurement_imports
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS backfill_run_id UUID,
  ADD COLUMN IF NOT EXISTS backfill_status TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aggregate_only BOOLEAN,
  ADD COLUMN IF NOT EXISTS total_area_sqft NUMERIC;

ALTER TABLE public.measurement_segments
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS backfill_run_id UUID,
  ADD COLUMN IF NOT EXISTS backfill_status TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

ALTER TABLE public.measurement_features
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS backfill_run_id UUID,
  ADD COLUMN IF NOT EXISTS backfill_status TEXT,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_measurement_imports_backfill_run
  ON public.measurement_imports (backfill_run_id) WHERE backfill_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_measurement_segments_backfill_run
  ON public.measurement_segments (backfill_run_id) WHERE backfill_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_measurement_features_backfill_run
  ON public.measurement_features (backfill_run_id) WHERE backfill_run_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
-- Phase 1.5: idempotency + global_fallback status for mapping assignments

ALTER TABLE public.estimate_measurement_assignments
  ADD COLUMN IF NOT EXISTS mapping_run_id UUID,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

-- Expand status CHECK to allow assigned_global_fallback (already emitted by mapper)
ALTER TABLE public.estimate_measurement_assignments
  DROP CONSTRAINT IF EXISTS estimate_measurement_assignments_status_check;

ALTER TABLE public.estimate_measurement_assignments
  ADD CONSTRAINT estimate_measurement_assignments_status_check
  CHECK (status IN ('assigned','assigned_global_fallback','unresolved','conflict','manual','skipped'));

CREATE INDEX IF NOT EXISTS idx_ema_active_mapping
  ON public.estimate_measurement_assignments(
    measurement_import_id, calc_template_id, estimate_id
  )
  WHERE superseded_at IS NULL AND is_dry_run = false;

CREATE INDEX IF NOT EXISTS idx_ema_run
  ON public.estimate_measurement_assignments(mapping_run_id)
  WHERE mapping_run_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
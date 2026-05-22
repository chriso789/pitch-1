
-- Add hard_fail_reason column to measurement tables for route-audit forensics.
-- Existing edge-function code already writes this field but it was being stripped
-- into geometry_report_json by the schema guard because the column did not exist.
ALTER TABLE public.roof_measurements    ADD COLUMN IF NOT EXISTS hard_fail_reason TEXT;
ALTER TABLE public.ai_measurement_jobs  ADD COLUMN IF NOT EXISTS hard_fail_reason TEXT;
ALTER TABLE public.measurement_jobs     ADD COLUMN IF NOT EXISTS hard_fail_reason TEXT;

-- Speed up the canonical-route lookup used by debug-measurement-runtime.
CREATE INDEX IF NOT EXISTS roof_measurements_canonical_route_idx
  ON public.roof_measurements (canonical_measurement_route, created_at DESC);

CREATE INDEX IF NOT EXISTS roof_measurements_lead_route_idx
  ON public.roof_measurements (lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

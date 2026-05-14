
ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS true_outer_roof_perimeter_px jsonb,
  ADD COLUMN IF NOT EXISTS true_outer_roof_perimeter_geo jsonb,
  ADD COLUMN IF NOT EXISTS eave_edges jsonb,
  ADD COLUMN IF NOT EXISTS rake_edges jsonb,
  ADD COLUMN IF NOT EXISTS roof_corners jsonb,
  ADD COLUMN IF NOT EXISTS missed_roof_regions jsonb,
  ADD COLUMN IF NOT EXISTS perimeter_confidence numeric,
  ADD COLUMN IF NOT EXISTS perimeter_source text,
  ADD COLUMN IF NOT EXISTS perimeter_hints jsonb,
  ADD COLUMN IF NOT EXISTS perimeter_gate_metrics jsonb,
  ADD COLUMN IF NOT EXISTS perimeter_status text;

ALTER TABLE public.measurement_jobs
  ADD COLUMN IF NOT EXISTS result_state text;

CREATE INDEX IF NOT EXISTS idx_roof_measurements_perimeter_status
  ON public.roof_measurements(perimeter_status);

CREATE INDEX IF NOT EXISTS idx_measurement_jobs_result_state
  ON public.measurement_jobs(result_state);


ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS gate_decision text,
  ADD COLUMN IF NOT EXISTS gate_reason text,
  ADD COLUMN IF NOT EXISTS gate_per_class jsonb,
  ADD COLUMN IF NOT EXISTS passes_strict_3pct boolean,
  ADD COLUMN IF NOT EXISTS failed_strict text[],
  ADD COLUMN IF NOT EXISTS failed_loose text[],
  ADD COLUMN IF NOT EXISTS gate_evaluated_at timestamptz;

COMMENT ON COLUMN public.roof_measurements.gate_decision IS 'EagleView 3% gate result: auto_ship | review_required | reject';
COMMENT ON COLUMN public.roof_measurements.passes_strict_3pct IS 'TRUE when every metric is within ±3% of vendor truth (EagleView strict standard).';

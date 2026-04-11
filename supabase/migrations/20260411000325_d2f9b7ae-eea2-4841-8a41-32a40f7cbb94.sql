-- Add missing columns for unified measurement pipeline
ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS lead_id uuid,
  ADD COLUMN IF NOT EXISTS measurement_data jsonb,
  ADD COLUMN IF NOT EXISTS vendor_report_id uuid,
  ADD COLUMN IF NOT EXISTS weighted_accuracy_score numeric,
  ADD COLUMN IF NOT EXISTS review_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS inference_source text DEFAULT 'pitch-internal-unet',
  ADD COLUMN IF NOT EXISTS confidence numeric;

-- Add indexes
CREATE INDEX IF NOT EXISTS roof_measurements_lead_id_idx
  ON public.roof_measurements (lead_id);

CREATE INDEX IF NOT EXISTS roof_measurements_vendor_report_id_idx
  ON public.roof_measurements (vendor_report_id);

CREATE INDEX IF NOT EXISTS roof_measurements_measurement_data_gin
  ON public.roof_measurements USING gin (measurement_data);

CREATE INDEX IF NOT EXISTS roof_measurements_overlay_schema_gin
  ON public.roof_measurements USING gin (overlay_schema);
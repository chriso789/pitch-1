
ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS property_address_id uuid,
  ADD COLUMN IF NOT EXISTS validated_address_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS address_validation_status_at_order text,
  ADD COLUMN IF NOT EXISTS address_validated_at_order timestamptz,
  ADD COLUMN IF NOT EXISTS address_override_reason_at_order text;

ALTER TABLE public.measurement_jobs
  ADD COLUMN IF NOT EXISTS property_address_id uuid,
  ADD COLUMN IF NOT EXISTS validated_address_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS address_validation_status_at_order text,
  ADD COLUMN IF NOT EXISTS address_validated_at_order timestamptz,
  ADD COLUMN IF NOT EXISTS address_override_reason_at_order text;

CREATE INDEX IF NOT EXISTS idx_ai_measurement_jobs_property_address
  ON public.ai_measurement_jobs(property_address_id);
CREATE INDEX IF NOT EXISTS idx_measurement_jobs_property_address
  ON public.measurement_jobs(property_address_id);

NOTIFY pgrst, 'reload schema';

ALTER TABLE public.roof_measurements
DROP CONSTRAINT IF EXISTS roof_measurements_validation_status_check;

ALTER TABLE public.roof_measurements
ADD CONSTRAINT roof_measurements_validation_status_check
CHECK (validation_status = ANY (ARRAY[
  'pending'::text,
  'validated'::text,
  'flagged'::text,
  'rejected'::text,
  'failed'::text,
  'needs_internal_review'::text,
  'needs_manual_measurement'::text
]));
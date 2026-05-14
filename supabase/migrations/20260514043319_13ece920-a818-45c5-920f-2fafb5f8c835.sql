-- Add result_state column to roof_measurements (already exists on ai_measurement_jobs and measurement_jobs)
ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS result_state text;

-- Safe enum-like check constraint
ALTER TABLE public.roof_measurements
  DROP CONSTRAINT IF EXISTS roof_measurements_result_state_check;

ALTER TABLE public.roof_measurements
  ADD CONSTRAINT roof_measurements_result_state_check
  CHECK (
    result_state IS NULL OR
    result_state IN (
      'customer_report_ready',
      'perimeter_only',
      'ai_failed_target_unconfirmed',
      'ai_failed_source_acquisition',
      'ai_failed_perimeter',
      'ai_failed_topology',
      'ai_failed_pitch',
      'ai_failed_schema',
      'ai_failed_unknown'
    )
  );

-- Same defensive constraint on the job tables (column already exists there)
ALTER TABLE public.ai_measurement_jobs
  DROP CONSTRAINT IF EXISTS ai_measurement_jobs_result_state_check;
ALTER TABLE public.ai_measurement_jobs
  ADD CONSTRAINT ai_measurement_jobs_result_state_check
  CHECK (
    result_state IS NULL OR
    result_state IN (
      'customer_report_ready',
      'perimeter_only',
      'ai_failed_target_unconfirmed',
      'ai_failed_source_acquisition',
      'ai_failed_perimeter',
      'ai_failed_topology',
      'ai_failed_pitch',
      'ai_failed_schema',
      'ai_failed_unknown'
    )
  );

ALTER TABLE public.measurement_jobs
  DROP CONSTRAINT IF EXISTS measurement_jobs_result_state_check;
ALTER TABLE public.measurement_jobs
  ADD CONSTRAINT measurement_jobs_result_state_check
  CHECK (
    result_state IS NULL OR
    result_state IN (
      'customer_report_ready',
      'perimeter_only',
      'ai_failed_target_unconfirmed',
      'ai_failed_source_acquisition',
      'ai_failed_perimeter',
      'ai_failed_topology',
      'ai_failed_pitch',
      'ai_failed_schema',
      'ai_failed_unknown'
    )
  );

-- Force PostgREST schema cache refresh so the new column is visible to edge functions immediately
NOTIFY pgrst, 'reload schema';
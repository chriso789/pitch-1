-- Add a dedicated runtime failure bucket for Edge CPU/runtime containment.
-- Specific detail remains in hard_fail_reason, e.g. ai_measurement_cpu_timeout.

ALTER TABLE public.roof_measurements
  DROP CONSTRAINT IF EXISTS roof_measurements_result_state_check;
ALTER TABLE public.roof_measurements
  ADD CONSTRAINT roof_measurements_result_state_check
  CHECK (
    result_state IS NULL OR result_state IN (
      'customer_report_ready',
      'perimeter_only',
      'diagnostic_only',
      'ai_failed_target_unconfirmed',
      'ai_failed_source_acquisition',
      'ai_failed_perimeter',
      'ai_failed_topology',
      'ai_failed_pitch',
      'ai_failed_schema',
      'ai_failed_runtime',
      'ai_failed_unknown'
    )
  );

ALTER TABLE public.ai_measurement_jobs
  DROP CONSTRAINT IF EXISTS ai_measurement_jobs_result_state_check;
ALTER TABLE public.ai_measurement_jobs
  ADD CONSTRAINT ai_measurement_jobs_result_state_check
  CHECK (
    result_state IS NULL OR result_state IN (
      'customer_report_ready',
      'perimeter_only',
      'diagnostic_only',
      'ai_failed_target_unconfirmed',
      'ai_failed_source_acquisition',
      'ai_failed_perimeter',
      'ai_failed_topology',
      'ai_failed_pitch',
      'ai_failed_schema',
      'ai_failed_runtime',
      'ai_failed_unknown'
    )
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='measurement_jobs' AND column_name='result_state'
  ) THEN
    EXECUTE 'ALTER TABLE public.measurement_jobs DROP CONSTRAINT IF EXISTS measurement_jobs_result_state_check';
    EXECUTE $c$
      ALTER TABLE public.measurement_jobs
      ADD CONSTRAINT measurement_jobs_result_state_check
      CHECK (
        result_state IS NULL OR result_state IN (
          'customer_report_ready',
          'perimeter_only',
          'diagnostic_only',
          'ai_failed_target_unconfirmed',
          'ai_failed_source_acquisition',
          'ai_failed_perimeter',
          'ai_failed_topology',
          'ai_failed_pitch',
          'ai_failed_schema',
          'ai_failed_runtime',
          'ai_failed_unknown'
        )
      )
    $c$;
  END IF;
END $$;

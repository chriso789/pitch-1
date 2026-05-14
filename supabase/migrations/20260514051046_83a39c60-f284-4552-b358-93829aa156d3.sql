-- Normalize result_state to a stable enum across all measurement tables.
-- Detailed failure context lives in hard_fail_reason / block_customer_report_reason
-- / geometry_report_json.failure_details, NOT in result_state itself.

-- Backfill any existing non-conforming rows so the new constraint applies cleanly.
DO $$
DECLARE
  allowed text[] := ARRAY[
    'customer_report_ready',
    'perimeter_only',
    'diagnostic_only',
    'ai_failed_target_unconfirmed',
    'ai_failed_source_acquisition',
    'ai_failed_perimeter',
    'ai_failed_topology',
    'ai_failed_pitch',
    'ai_failed_schema',
    'ai_failed_unknown'
  ];
BEGIN
  -- roof_measurements
  UPDATE public.roof_measurements
     SET result_state = CASE
       WHEN result_state IS NULL THEN NULL
       WHEN result_state = ANY(allowed) THEN result_state
       WHEN result_state ILIKE '%target%' THEN 'ai_failed_target_unconfirmed'
       WHEN result_state ILIKE '%source%' OR result_state ILIKE '%acquisition%' THEN 'ai_failed_source_acquisition'
       WHEN result_state ILIKE '%perimeter%' OR result_state ILIKE '%target_mask%' THEN 'ai_failed_perimeter'
       WHEN result_state ILIKE '%topology%' OR result_state ILIKE '%patent%' THEN 'ai_failed_topology'
       WHEN result_state ILIKE '%pitch%' THEN 'ai_failed_pitch'
       WHEN result_state ILIKE '%schema%' THEN 'ai_failed_schema'
       ELSE 'ai_failed_unknown'
     END
   WHERE result_state IS NOT NULL AND result_state <> ALL(allowed);

  -- ai_measurement_jobs
  UPDATE public.ai_measurement_jobs
     SET result_state = CASE
       WHEN result_state IS NULL THEN NULL
       WHEN result_state = ANY(allowed) THEN result_state
       WHEN result_state ILIKE '%target%' THEN 'ai_failed_target_unconfirmed'
       WHEN result_state ILIKE '%source%' OR result_state ILIKE '%acquisition%' THEN 'ai_failed_source_acquisition'
       WHEN result_state ILIKE '%perimeter%' OR result_state ILIKE '%target_mask%' THEN 'ai_failed_perimeter'
       WHEN result_state ILIKE '%topology%' OR result_state ILIKE '%patent%' THEN 'ai_failed_topology'
       WHEN result_state ILIKE '%pitch%' THEN 'ai_failed_pitch'
       WHEN result_state ILIKE '%schema%' THEN 'ai_failed_schema'
       ELSE 'ai_failed_unknown'
     END
   WHERE result_state IS NOT NULL AND result_state <> ALL(allowed);

  -- measurement_jobs (only if column exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='measurement_jobs' AND column_name='result_state'
  ) THEN
    UPDATE public.measurement_jobs
       SET result_state = CASE
         WHEN result_state IS NULL THEN NULL
         WHEN result_state = ANY(allowed) THEN result_state
         WHEN result_state ILIKE '%target%' THEN 'ai_failed_target_unconfirmed'
         WHEN result_state ILIKE '%source%' OR result_state ILIKE '%acquisition%' THEN 'ai_failed_source_acquisition'
         WHEN result_state ILIKE '%perimeter%' OR result_state ILIKE '%target_mask%' THEN 'ai_failed_perimeter'
         WHEN result_state ILIKE '%topology%' OR result_state ILIKE '%patent%' THEN 'ai_failed_topology'
         WHEN result_state ILIKE '%pitch%' THEN 'ai_failed_pitch'
         WHEN result_state ILIKE '%schema%' THEN 'ai_failed_schema'
         ELSE 'ai_failed_unknown'
       END
     WHERE result_state IS NOT NULL AND result_state <> ALL(allowed);
  END IF;
END $$;

-- Drop and recreate constraints with the stable enum.
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
          'ai_failed_unknown'
        )
      )
    $c$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
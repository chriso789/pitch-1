DO $$
DECLARE
  bad_measurement_ids uuid[];
  bad_ai_job_ids uuid[];
BEGIN
  SELECT array_agg(id), array_agg(ai_measurement_job_id)
  INTO bad_measurement_ids, bad_ai_job_ids
  FROM public.roof_measurements
  WHERE ai_measurement_job_id IS NOT NULL
    AND COALESCE(total_area_adjusted_sqft, total_area_flat_sqft, 0) > 30000
    AND (
      detection_method = 'geometry_first_v2'
      OR engine_version = 'geometry_first_v2'
      OR geometry_report_json->>'engine' = 'geometry_first_v2'
    );

  DELETE FROM public.measurement_approvals
  WHERE (
    measurement_id = ANY(COALESCE(bad_measurement_ids, ARRAY[]::uuid[]))
    OR ai_measurement_job_id = ANY(COALESCE(bad_ai_job_ids, ARRAY[]::uuid[]))
    OR (saved_tags->>'measurement_id')::uuid = ANY(COALESCE(bad_measurement_ids, ARRAY[]::uuid[]))
  )
  AND COALESCE(NULLIF(saved_tags->>'roof.total_sqft', '')::numeric, NULLIF(saved_tags->>'roof.plan_area', '')::numeric, 0) > 30000;

  UPDATE public.measurement_jobs
  SET status = 'failed',
      progress_message = 'Rejected inflated geometry — no customer-facing measurement was saved.',
      error = 'Rejected inflated geometry: measured roof area exceeded the publishable residential cap.',
      measurement_id = NULL,
      completed_at = COALESCE(completed_at, now()),
      updated_at = now()
  WHERE ai_measurement_job_id = ANY(COALESCE(bad_ai_job_ids, ARRAY[]::uuid[]));

  UPDATE public.ai_measurement_jobs
  SET status = 'needs_internal_review',
      status_message = 'Rejected inflated geometry — roof footprint touched the satellite tile frame or exceeded area cap.',
      updated_at = now()
  WHERE id = ANY(COALESCE(bad_ai_job_ids, ARRAY[]::uuid[]));

  UPDATE public.roof_measurements
  SET validation_status = 'flagged',
      requires_manual_review = true,
      measurement_confidence = LEAST(COALESCE(measurement_confidence, 1), 0.1),
      geometry_quality_score = LEAST(COALESCE(geometry_quality_score, 1), 0.1),
      measurement_quality_score = LEAST(COALESCE(measurement_quality_score, 1), 0.1)
  WHERE id = ANY(COALESCE(bad_measurement_ids, ARRAY[]::uuid[]));
END $$;
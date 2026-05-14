ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS archetype_debug jsonb,
  ADD COLUMN IF NOT EXISTS eave_rake_classification_debug jsonb,
  ADD COLUMN IF NOT EXISTS perimeter_edge_pitch_relation jsonb,
  ADD COLUMN IF NOT EXISTS diagram_render_intent text;

ALTER TABLE public.roof_measurements
  DROP CONSTRAINT IF EXISTS roof_measurements_diagram_render_intent_check;

ALTER TABLE public.roof_measurements
  ADD CONSTRAINT roof_measurements_diagram_render_intent_check
  CHECK (
    diagram_render_intent IS NULL OR diagram_render_intent IN (
      'full_topology',
      'perimeter_only',
      'rejected_only',
      'diagnostic_only'
    )
  );

UPDATE public.roof_measurements
SET result_state = CASE
  WHEN result_state IS NOT NULL THEN result_state
  WHEN validation_status = 'validated' OR customer_report_ready IS TRUE THEN 'customer_report_ready'
  WHEN validation_status = 'needs_internal_review' THEN 'perimeter_only'
  WHEN lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%target%' THEN 'ai_failed_target_unconfirmed'
  WHEN lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%source%'
    OR lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%acquisition%'
    OR lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%solar%'
    OR lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%dsm%'
    OR lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%http%'
  THEN 'ai_failed_source_acquisition'
  WHEN lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%perimeter%'
    OR lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%footprint%'
    OR lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%mask%'
  THEN 'ai_failed_perimeter'
  WHEN lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%topology%'
    OR lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%facet%'
    OR lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%ridge%'
    OR lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%plane%'
  THEN 'ai_failed_topology'
  WHEN lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%pitch%' THEN 'ai_failed_pitch'
  WHEN lower(coalesce(block_customer_report_reason, gate_reason, last_failure_reason, validation_notes, '')) LIKE '%schema%' THEN 'ai_failed_schema'
  WHEN validation_status = 'failed' THEN 'ai_failed_unknown'
  ELSE result_state
END,
diagram_render_intent = CASE
  WHEN diagram_render_intent IS NOT NULL THEN diagram_render_intent
  WHEN customer_report_ready IS TRUE THEN 'full_topology'
  WHEN validation_status = 'needs_internal_review' THEN 'perimeter_only'
  WHEN validation_status = 'failed' THEN 'rejected_only'
  ELSE diagram_render_intent
END
WHERE result_state IS NULL OR diagram_render_intent IS NULL;

UPDATE public.ai_measurement_jobs
SET result_state = CASE
  WHEN result_state IS NOT NULL THEN result_state
  WHEN status = 'completed' THEN 'customer_report_ready'
  WHEN lower(coalesce(failure_reason, status_message, '')) LIKE '%target%' THEN 'ai_failed_target_unconfirmed'
  WHEN lower(coalesce(failure_reason, status_message, '')) LIKE '%source%'
    OR lower(coalesce(failure_reason, status_message, '')) LIKE '%acquisition%'
    OR lower(coalesce(failure_reason, status_message, '')) LIKE '%solar%'
    OR lower(coalesce(failure_reason, status_message, '')) LIKE '%dsm%'
    OR lower(coalesce(failure_reason, status_message, '')) LIKE '%http%'
  THEN 'ai_failed_source_acquisition'
  WHEN lower(coalesce(failure_reason, status_message, '')) LIKE '%perimeter%'
    OR lower(coalesce(failure_reason, status_message, '')) LIKE '%footprint%'
    OR lower(coalesce(failure_reason, status_message, '')) LIKE '%mask%'
  THEN 'ai_failed_perimeter'
  WHEN lower(coalesce(failure_reason, status_message, '')) LIKE '%topology%'
    OR lower(coalesce(failure_reason, status_message, '')) LIKE '%facet%'
    OR lower(coalesce(failure_reason, status_message, '')) LIKE '%ridge%'
    OR lower(coalesce(failure_reason, status_message, '')) LIKE '%plane%'
  THEN 'ai_failed_topology'
  WHEN lower(coalesce(failure_reason, status_message, '')) LIKE '%pitch%' THEN 'ai_failed_pitch'
  WHEN lower(coalesce(failure_reason, status_message, '')) LIKE '%schema%' THEN 'ai_failed_schema'
  WHEN status = 'failed' THEN 'ai_failed_unknown'
  ELSE result_state
END
WHERE result_state IS NULL;
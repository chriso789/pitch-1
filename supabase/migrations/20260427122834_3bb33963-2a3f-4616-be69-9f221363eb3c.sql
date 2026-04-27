DO $$
DECLARE
  bad_approval_ids uuid[];
BEGIN
  SELECT array_agg(id)
  INTO bad_approval_ids
  FROM public.measurement_approvals
  WHERE COALESCE(NULLIF(saved_tags->>'roof.total_sqft', '')::numeric, NULLIF(saved_tags->>'roof.plan_area', '')::numeric, 0) > 30000
    AND lower(COALESCE(saved_tags->>'source', approval_notes, '')) LIKE ANY (ARRAY['%geometry_first_v2%', '%ai_pulled%', '%ai measurement%']);

  UPDATE public.pipeline_entries
  SET metadata = metadata - 'selected_measurement_approval_id'
  WHERE metadata ? 'selected_measurement_approval_id'
    AND (metadata->>'selected_measurement_approval_id')::uuid = ANY(COALESCE(bad_approval_ids, ARRAY[]::uuid[]));

  DELETE FROM public.measurement_approvals
  WHERE id = ANY(COALESCE(bad_approval_ids, ARRAY[]::uuid[]));
END $$;
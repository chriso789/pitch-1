UPDATE public.roof_training_sessions s
SET verification_status = NULL,
    verification_notes = NULL
FROM public.roof_vendor_reports r
WHERE s.vendor_report_id = r.id
  AND s.ground_truth_source = 'vendor_report'
  AND s.verification_status = 'skipped'
  AND s.verification_verdict IS NULL
  AND (
    COALESCE((r.parsed->>'eaves_ft')::numeric, 0) > 0
    OR COALESCE((r.parsed->>'rakes_ft')::numeric, 0) > 0
    OR COALESCE((r.parsed->>'ridges_ft')::numeric, 0) > 0
    OR COALESCE((r.parsed->>'hips_ft')::numeric, 0) > 0
    OR COALESCE((r.parsed->>'valleys_ft')::numeric, 0) > 0
  );

-- Refresh traced_totals to use the canonical key names the verification engine expects (ridge, hip, valley, eave, rake)
UPDATE public.roof_training_sessions s
SET traced_totals = jsonb_strip_nulls(jsonb_build_object(
  'ridge', NULLIF((r.parsed->>'ridges_ft')::numeric, 0),
  'hip', NULLIF((r.parsed->>'hips_ft')::numeric, 0),
  'valley', NULLIF((r.parsed->>'valleys_ft')::numeric, 0),
  'eave', NULLIF((r.parsed->>'eaves_ft')::numeric, 0),
  'rake', NULLIF((r.parsed->>'rakes_ft')::numeric, 0),
  'ridge_ft', NULLIF((r.parsed->>'ridges_ft')::numeric, 0),
  'hip_ft', NULLIF((r.parsed->>'hips_ft')::numeric, 0),
  'valley_ft', NULLIF((r.parsed->>'valleys_ft')::numeric, 0),
  'eave_ft', NULLIF((r.parsed->>'eaves_ft')::numeric, 0),
  'rake_ft', NULLIF((r.parsed->>'rakes_ft')::numeric, 0),
  'total_area_sqft', NULLIF((r.parsed->>'total_area_sqft')::numeric, 0),
  'predominant_pitch', r.parsed->>'predominant_pitch',
  'facet_count', NULLIF((r.parsed->>'facet_count')::numeric, 0)
))
FROM public.roof_vendor_reports r
WHERE s.vendor_report_id = r.id
  AND r.parsed IS NOT NULL;
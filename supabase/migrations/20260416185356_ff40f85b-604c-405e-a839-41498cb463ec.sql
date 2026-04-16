UPDATE public.roof_training_sessions s
SET traced_totals = jsonb_strip_nulls(jsonb_build_object(
  'total_area_sqft', NULLIF((r.parsed->>'total_area_sqft')::numeric, 0),
  'predominant_pitch', r.parsed->>'predominant_pitch',
  'eaves_ft', NULLIF((r.parsed->>'eaves_ft')::numeric, 0),
  'rakes_ft', NULLIF((r.parsed->>'rakes_ft')::numeric, 0),
  'ridges_ft', NULLIF((r.parsed->>'ridges_ft')::numeric, 0),
  'hips_ft', NULLIF((r.parsed->>'hips_ft')::numeric, 0),
  'valleys_ft', NULLIF((r.parsed->>'valleys_ft')::numeric, 0),
  'facet_count', NULLIF((r.parsed->>'facet_count')::numeric, 0)
))
FROM public.roof_vendor_reports r
WHERE s.vendor_report_id = r.id
  AND r.parsed IS NOT NULL;
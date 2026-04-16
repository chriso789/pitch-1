-- Backfill: copy vendor_report.geocoded_lat/lng into roof_training_sessions where missing
UPDATE public.roof_training_sessions s
SET lat = r.geocoded_lat,
    lng = r.geocoded_lng
FROM public.roof_vendor_reports r
WHERE s.vendor_report_id = r.id
  AND (s.lat IS NULL OR s.lng IS NULL)
  AND r.geocoded_lat IS NOT NULL
  AND r.geocoded_lng IS NOT NULL;

-- Backfill: prefer the longer/fuller parsed address from the report when the session's stored address is shorter
UPDATE public.roof_training_sessions s
SET property_address = r.parsed->>'address'
FROM public.roof_vendor_reports r
WHERE s.vendor_report_id = r.id
  AND r.parsed ? 'address'
  AND (r.parsed->>'address') IS NOT NULL
  AND length(r.parsed->>'address') > COALESCE(length(s.property_address), 0);

-- Reset failed/skipped sessions that we now have coords for so they can retry
UPDATE public.roof_training_sessions
SET verification_status = NULL,
    verification_notes = NULL,
    verification_run_at = NULL
WHERE ground_truth_source = 'vendor_report'
  AND verification_verdict IS NULL
  AND verification_status IN ('failed','skipped')
  AND lat IS NOT NULL
  AND lng IS NOT NULL;
ALTER TABLE public.roof_measurements DROP CONSTRAINT IF EXISTS roof_measurements_footprint_source_check;

ALTER TABLE public.roof_measurements
  ADD CONSTRAINT roof_measurements_footprint_source_check
  CHECK (
    footprint_source IS NULL
    OR footprint_source = ANY (ARRAY[
      'mapbox_vector','regrid_parcel','osm_overpass','microsoft_buildings',
      'solar_api_footprint','solar_bbox_fallback','manual_trace','manual_entry',
      'imported','user_drawn','ai_detection','esri_buildings','google_solar_api',
      'osm','google_maps','satellite','unknown',
      'google_solar_bbox','google_solar_segments','google_solar_segments_hull',
      'unet_mask','alpha_hull','convex_hull'
    ])
  );

UPDATE public.measurement_jobs
SET status = 'failed',
    error = COALESCE(error, 'Stuck in processing — auto-failed by maintenance'),
    progress_message = 'Timed out — please re-run AI measurement',
    completed_at = NOW()
WHERE status IN ('queued','processing')
  AND created_at < NOW() - INTERVAL '5 minutes';
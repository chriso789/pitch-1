-- Fix Caylan's login status - Insert login activity event
INSERT INTO session_activity_log (
  user_id,
  email,
  event_type,
  success,
  device_info,
  created_at
) VALUES (
  '78b6adc2-0eec-448d-8836-f94a61ad3918',
  'legacyexteriors.co@gmail.com',
  'login_success',
  true,
  'Password Setup - First Login',
  NOW()
);

-- Backfill gps_coordinates for measurements from visualization_metadata
UPDATE measurements 
SET gps_coordinates = jsonb_build_object(
  'lat', (visualization_metadata->'center'->>'lat')::numeric,
  'lng', (visualization_metadata->'center'->>'lng')::numeric
)
WHERE gps_coordinates IS NULL
  AND visualization_metadata IS NOT NULL
  AND visualization_metadata->'center' IS NOT NULL
  AND visualization_metadata->'center'->>'lat' IS NOT NULL;

-- Backfill analysis_zoom from visualization_metadata where available  
UPDATE measurements 
SET analysis_zoom = COALESCE(ROUND((visualization_metadata->>'zoom')::numeric)::integer, 20)
WHERE analysis_zoom IS NULL
  AND visualization_metadata IS NOT NULL
  AND visualization_metadata->>'zoom' IS NOT NULL;
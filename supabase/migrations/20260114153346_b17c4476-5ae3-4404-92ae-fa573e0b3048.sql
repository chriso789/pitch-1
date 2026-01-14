-- Add the constraint with all possible values
ALTER TABLE roof_measurements DROP CONSTRAINT IF EXISTS roof_measurements_footprint_source_check;

ALTER TABLE roof_measurements ADD CONSTRAINT roof_measurements_footprint_source_check 
  CHECK (footprint_source IS NULL OR footprint_source IN (
    'mapbox_vector',
    'regrid_parcel', 
    'osm_overpass',
    'microsoft_buildings',
    'solar_api_footprint',
    'solar_bbox_fallback',
    'manual_trace',
    'imported',
    'user_drawn',
    'ai_detection',
    'esri_buildings',
    'google_solar_api',
    'osm',
    'google_maps',
    'satellite',
    'unknown'
  ));
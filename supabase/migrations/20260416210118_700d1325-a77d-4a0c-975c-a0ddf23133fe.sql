-- Drop the ambiguous 7-arg overload of insert_measurement.
-- The 10-arg version (with gps_coordinates, analysis_zoom, analysis_image_size) is the canonical one.
DROP FUNCTION IF EXISTS public.insert_measurement(
  p_property_id uuid,
  p_source text,
  p_faces jsonb,
  p_summary jsonb,
  p_created_by uuid,
  p_geom_wkt text,
  p_linear_features jsonb
);
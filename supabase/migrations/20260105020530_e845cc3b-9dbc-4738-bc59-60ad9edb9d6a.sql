-- Add analysis parameter columns to measurements table for overlay alignment
ALTER TABLE measurements 
ADD COLUMN IF NOT EXISTS gps_coordinates JSONB,
ADD COLUMN IF NOT EXISTS analysis_zoom INTEGER DEFAULT 20,
ADD COLUMN IF NOT EXISTS analysis_image_size JSONB DEFAULT '{"width": 640, "height": 640}';

-- Add comments for documentation
COMMENT ON COLUMN measurements.gps_coordinates IS 'Center lat/lng used during measurement analysis - overlay must use these exact values';
COMMENT ON COLUMN measurements.analysis_zoom IS 'Zoom level used during analysis for coordinate-to-pixel conversion';
COMMENT ON COLUMN measurements.analysis_image_size IS 'Image dimensions {width, height} used during analysis';

-- Backfill existing measurements from visualization_metadata where available
-- Use ROUND to handle decimal zoom values like 19.5
UPDATE measurements 
SET gps_coordinates = jsonb_build_object(
  'lat', (visualization_metadata->'center'->>'lat')::numeric,
  'lng', (visualization_metadata->'center'->>'lng')::numeric
),
analysis_zoom = ROUND((visualization_metadata->>'zoom')::numeric)::integer
WHERE visualization_metadata IS NOT NULL 
  AND visualization_metadata->'center' IS NOT NULL
  AND visualization_metadata->'center'->>'lat' IS NOT NULL
  AND gps_coordinates IS NULL;

-- Update insert_measurement function to accept new parameters
CREATE OR REPLACE FUNCTION insert_measurement(
  p_property_id UUID,
  p_source TEXT,
  p_faces JSONB,
  p_linear_features JSONB,
  p_summary JSONB,
  p_created_by UUID,
  p_geom_wkt TEXT,
  p_gps_coordinates JSONB DEFAULT NULL,
  p_analysis_zoom INTEGER DEFAULT 20,
  p_analysis_image_size JSONB DEFAULT '{"width": 640, "height": 640}'
)
RETURNS measurements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE 
  v_new_row measurements;
BEGIN
  INSERT INTO measurements(
    property_id, 
    source, 
    faces, 
    linear_features,
    summary, 
    created_by, 
    geom_geog,
    gps_coordinates,
    analysis_zoom,
    analysis_image_size
  )
  VALUES (
    p_property_id, 
    p_source, 
    p_faces,
    p_linear_features,
    p_summary, 
    p_created_by,
    CASE 
      WHEN p_geom_wkt IS NULL THEN NULL 
      ELSE ST_GeogFromText(p_geom_wkt) 
    END,
    p_gps_coordinates,
    p_analysis_zoom,
    p_analysis_image_size
  )
  RETURNING * INTO v_new_row;

  RETURN v_new_row;
END;
$$;
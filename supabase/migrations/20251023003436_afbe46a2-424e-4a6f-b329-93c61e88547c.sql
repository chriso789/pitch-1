-- Phase 1: Add penetrations and age fields to measurements
-- Enables tracking of roof penetrations (vents, skylights, chimneys, HVAC) and roof age

-- Add penetrations column to measurements table
ALTER TABLE measurements
  ADD COLUMN IF NOT EXISTS penetrations JSONB NOT NULL DEFAULT '[]';

-- Add comment documenting expected penetrations structure
COMMENT ON COLUMN measurements.penetrations IS 
'Array of penetration objects: [{type: "pipe_vent"|"skylight"|"chimney"|"hvac"|"other", count: number, points?: string[]}]
- type: Type of penetration
- count: Number of penetrations of this type
- points: Optional array of WKT POINT geometries for exact locations';

-- Add comment documenting expected summary JSONB structure additions
COMMENT ON COLUMN measurements.summary IS 
'Measurement summary containing:
- total_area_sqft: Total roof area in square feet
- total_squares: Total roofing squares (area / 100)
- waste_pct: Waste percentage for materials
- pitch_method: How pitch was determined ("manual"|"vendor"|"assumed")
- perimeter_ft: Total perimeter length in feet
- ridge_ft: Total ridge length in feet
- hip_ft: Total hip length in feet
- valley_ft: Total valley length in feet
- eave_ft: Total eave length in feet
- rake_ft: Total rake length in feet
- roof_age_years: Age of roof in years (nullable)
- roof_age_source: Source of age data ("user"|"permit"|"assessor"|"unknown")';

-- Create helper function to calculate perimeter from linear features
CREATE OR REPLACE FUNCTION public.calculate_perimeter_from_linear_features(linear_features JSONB)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  total_perimeter numeric := 0;
  feature jsonb;
BEGIN
  FOR feature IN SELECT * FROM jsonb_array_elements(linear_features)
  LOOP
    IF feature->>'type' IN ('eave', 'rake') THEN
      total_perimeter := total_perimeter + COALESCE((feature->>'length_ft')::numeric, 0);
    END IF;
  END LOOP;
  
  RETURN total_perimeter;
END;
$$;
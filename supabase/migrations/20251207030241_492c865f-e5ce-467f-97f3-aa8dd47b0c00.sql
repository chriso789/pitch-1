-- Add linear_features_wkt column to roof_measurements for storing WKT geometry features
ALTER TABLE roof_measurements 
ADD COLUMN IF NOT EXISTS linear_features_wkt JSONB DEFAULT '[]'::jsonb;

-- Add comment explaining the column
COMMENT ON COLUMN roof_measurements.linear_features_wkt IS 'Linear features (ridges, hips, valleys) with WKT geometry from GPT-4 Vision, Google Solar, and AI analysis';
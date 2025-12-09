-- Add columns for AI-detected roof edges and perimeter
ALTER TABLE roof_measurements 
ADD COLUMN IF NOT EXISTS edge_segments JSONB,
ADD COLUMN IF NOT EXISTS roof_perimeter JSONB,
ADD COLUMN IF NOT EXISTS perimeter_wkt TEXT;

-- Add comment for documentation
COMMENT ON COLUMN roof_measurements.edge_segments IS 'AI-detected edge segments with type (eave/rake/ridge/hip/valley) and percentage coordinates';
COMMENT ON COLUMN roof_measurements.roof_perimeter IS 'AI-detected roof perimeter polygon as percentage coordinates';
COMMENT ON COLUMN roof_measurements.perimeter_wkt IS 'WKT POLYGON of the actual roof boundary for overlay rendering';
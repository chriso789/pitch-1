-- Add vision_edges column to store raw GPT-4 Vision detection results
ALTER TABLE roof_measurements 
ADD COLUMN IF NOT EXISTS vision_edges JSONB;

-- Add comment for documentation
COMMENT ON COLUMN roof_measurements.vision_edges IS 'Raw GPT-4 Vision detected ridge/hip/valley lines with percentage coordinates for debugging and verification';
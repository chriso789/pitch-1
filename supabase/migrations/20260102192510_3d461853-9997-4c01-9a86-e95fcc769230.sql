-- Add metadata column to roof_measurements for storing additional measurement details
ALTER TABLE roof_measurements 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

COMMENT ON COLUMN roof_measurements.metadata IS 'Additional measurement metadata including shadow risk, quality scores, and detection parameters';
-- Phase 6: Add AI vision footprint detection tracking columns
ALTER TABLE roof_measurements 
  ADD COLUMN IF NOT EXISTS ai_vision_footprint_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS ai_vision_detection_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS footprint_detection_method TEXT;

-- Add index for footprint detection method queries
CREATE INDEX IF NOT EXISTS idx_roof_measurements_footprint_detection_method 
ON roof_measurements(footprint_detection_method) 
WHERE footprint_detection_method IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN roof_measurements.ai_vision_footprint_confidence IS 'Confidence score (0-1) from AI vision-based footprint detection';
COMMENT ON COLUMN roof_measurements.ai_vision_detection_attempts IS 'Number of AI vision detection attempts made';
COMMENT ON COLUMN roof_measurements.footprint_detection_method IS 'Method used: api, ai_vision, manual';
-- Add columns to track original vs corrected AI measurements
ALTER TABLE roof_training_sessions 
ADD COLUMN IF NOT EXISTS original_ai_measurement_id UUID REFERENCES measurements(id),
ADD COLUMN IF NOT EXISTS corrected_ai_measurement_id UUID REFERENCES measurements(id);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_roof_training_sessions_original_ai 
ON roof_training_sessions(original_ai_measurement_id) 
WHERE original_ai_measurement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roof_training_sessions_corrected_ai 
ON roof_training_sessions(corrected_ai_measurement_id) 
WHERE corrected_ai_measurement_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN roof_training_sessions.original_ai_measurement_id IS 'The AI measurement BEFORE any training corrections - never modified';
COMMENT ON COLUMN roof_training_sessions.corrected_ai_measurement_id IS 'The AI measurement AFTER applying training corrections';
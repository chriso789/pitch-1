-- Phase 6: Add session and property scoping to measurement_corrections
-- This enables corrections to be grouped by training session and property

ALTER TABLE measurement_corrections 
ADD COLUMN IF NOT EXISTS training_session_id UUID REFERENCES roof_training_sessions(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS property_id UUID;

-- Create indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_corrections_training_session ON measurement_corrections(training_session_id);
CREATE INDEX IF NOT EXISTS idx_corrections_property ON measurement_corrections(property_id);

-- Add comment explaining the columns
COMMENT ON COLUMN measurement_corrections.training_session_id IS 'Links correction to the specific training session that created it';
COMMENT ON COLUMN measurement_corrections.property_id IS 'Links correction to the property (pipeline_entry_id) for property-scoped learning';
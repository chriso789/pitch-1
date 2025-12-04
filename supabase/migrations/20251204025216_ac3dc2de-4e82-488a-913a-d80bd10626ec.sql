-- Add historical measurement verification fields to measurements table
ALTER TABLE measurements 
  ADD COLUMN IF NOT EXISTS imagery_date DATE,
  ADD COLUMN IF NOT EXISTS imagery_source TEXT DEFAULT 'google_solar',
  ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'pending' CHECK (validation_status IN ('pending', 'validated', 'flagged', 'manually_verified')),
  ADD COLUMN IF NOT EXISTS validation_notes TEXT,
  ADD COLUMN IF NOT EXISTS validation_score DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS flagged_for_review BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS flagged_reason TEXT,
  ADD COLUMN IF NOT EXISTS manual_override BOOLEAN DEFAULT false;

-- Create index for efficient querying of flagged measurements
CREATE INDEX IF NOT EXISTS idx_measurements_validation_status ON measurements(validation_status);
CREATE INDEX IF NOT EXISTS idx_measurements_flagged ON measurements(flagged_for_review) WHERE flagged_for_review = true;

-- Add comment explaining the validation statuses
COMMENT ON COLUMN measurements.validation_status IS 'pending: awaiting review, validated: auto-approved, flagged: needs attention, manually_verified: human-verified';
COMMENT ON COLUMN measurements.imagery_date IS 'Date of the satellite/aerial imagery used for measurement (from Google Solar API imageryDate field)';
COMMENT ON COLUMN measurements.validation_score IS 'Computed validation score (0-100) based on multiple quality checks';
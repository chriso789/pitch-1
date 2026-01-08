-- Add ai_totals and traced_totals columns to roof_training_sessions for storing comparison data
ALTER TABLE roof_training_sessions 
ADD COLUMN IF NOT EXISTS ai_totals JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS traced_totals JSONB DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN roof_training_sessions.ai_totals IS 'Stores AI-generated measurement totals {ridge, hip, valley, eave, rake} in feet for comparison';
COMMENT ON COLUMN roof_training_sessions.traced_totals IS 'Stores manually traced totals {ridge, hip, valley, eave, rake} in feet for comparison';
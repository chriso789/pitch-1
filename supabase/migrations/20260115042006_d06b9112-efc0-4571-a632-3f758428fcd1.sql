-- Add display_name column to enhanced_estimates for custom estimate naming
ALTER TABLE enhanced_estimates 
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Add comment explaining purpose
COMMENT ON COLUMN enhanced_estimates.display_name IS 
  'Optional custom name for the estimate. If null, estimate_number is used as display name.';
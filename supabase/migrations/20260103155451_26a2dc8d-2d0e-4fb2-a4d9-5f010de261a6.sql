-- Add columns to track manual cost overrides
ALTER TABLE enhanced_estimates 
ADD COLUMN IF NOT EXISTS material_cost_manual boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS labor_cost_manual boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS manual_override_notes text;

-- Add comment for documentation
COMMENT ON COLUMN enhanced_estimates.material_cost_manual IS 'True if material_cost was manually entered instead of calculated';
COMMENT ON COLUMN enhanced_estimates.labor_cost_manual IS 'True if labor_cost was manually entered instead of calculated';
COMMENT ON COLUMN enhanced_estimates.manual_override_notes IS 'Notes explaining manual cost overrides';
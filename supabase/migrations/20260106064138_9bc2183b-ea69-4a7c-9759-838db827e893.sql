-- Add cost locking columns to enhanced_estimates
ALTER TABLE enhanced_estimates 
  ADD COLUMN IF NOT EXISTS material_cost_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS material_cost_locked_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS labor_cost_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS labor_cost_locked_by UUID REFERENCES profiles(id);

-- Add comment for clarity
COMMENT ON COLUMN enhanced_estimates.material_cost_locked_at IS 'Timestamp when material costs were locked as the original baseline';
COMMENT ON COLUMN enhanced_estimates.material_cost_locked_by IS 'User who locked the material costs';
COMMENT ON COLUMN enhanced_estimates.labor_cost_locked_at IS 'Timestamp when labor costs were locked as the original baseline';
COMMENT ON COLUMN enhanced_estimates.labor_cost_locked_by IS 'User who locked the labor costs';
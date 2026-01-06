-- Add pipeline_entry_id to project_cost_invoices for pre-project invoice tracking
ALTER TABLE project_cost_invoices 
  ADD COLUMN IF NOT EXISTS pipeline_entry_id UUID REFERENCES pipeline_entries(id) ON DELETE SET NULL;

-- Allow invoices before project is created by making project_id nullable
ALTER TABLE project_cost_invoices 
  ALTER COLUMN project_id DROP NOT NULL;

-- Add index for faster lookups by pipeline_entry_id
CREATE INDEX IF NOT EXISTS idx_project_cost_invoices_pipeline_entry_id 
  ON project_cost_invoices(pipeline_entry_id);

-- Add check constraint to ensure at least one reference exists
ALTER TABLE project_cost_invoices 
  ADD CONSTRAINT chk_project_or_pipeline_entry 
  CHECK (project_id IS NOT NULL OR pipeline_entry_id IS NOT NULL);

COMMENT ON COLUMN project_cost_invoices.pipeline_entry_id IS 'Optional link to pipeline entry for invoices submitted before project creation';
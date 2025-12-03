-- Create composite index for faster pipeline queries
CREATE INDEX IF NOT EXISTS idx_pipeline_entries_tenant_status_created 
ON pipeline_entries(tenant_id, is_deleted, status, created_at DESC);

-- Create index for contact lookups in pipeline
CREATE INDEX IF NOT EXISTS idx_pipeline_entries_contact_id 
ON pipeline_entries(contact_id) WHERE is_deleted = false;
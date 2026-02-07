-- Add key column to pipeline_stages for explicit status key mapping
ALTER TABLE pipeline_stages 
ADD COLUMN IF NOT EXISTS key TEXT;

-- Add unique constraint per tenant (key must be unique within a tenant)
ALTER TABLE pipeline_stages
ADD CONSTRAINT pipeline_stages_tenant_key_unique 
UNIQUE (tenant_id, key);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_tenant_key ON pipeline_stages(tenant_id, key);
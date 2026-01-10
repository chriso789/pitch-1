-- Fix duplicate production_stages entries
-- Keep only the oldest entry for each tenant_id + stage_key combination

-- First, delete duplicates (keeping the one with the earliest created_at)
DELETE FROM production_stages 
WHERE id NOT IN (
  SELECT DISTINCT ON (tenant_id, stage_key) id 
  FROM production_stages 
  ORDER BY tenant_id, stage_key, created_at ASC
);

-- Add unique constraint to prevent future duplicates
ALTER TABLE production_stages 
ADD CONSTRAINT production_stages_tenant_stage_unique 
UNIQUE (tenant_id, stage_key);

-- Create an index for better query performance
CREATE INDEX IF NOT EXISTS idx_production_stages_tenant_order 
ON production_stages(tenant_id, sort_order);
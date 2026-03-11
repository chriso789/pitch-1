-- Backfill orphaned pipeline_entries with NULL location_id
-- Assigns each entry to the first location of its tenant
UPDATE pipeline_entries pe
SET location_id = (
  SELECT l.id FROM locations l 
  WHERE l.tenant_id = pe.tenant_id 
  ORDER BY l.created_at ASC 
  LIMIT 1
)
WHERE pe.location_id IS NULL;
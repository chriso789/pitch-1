-- Soft-delete orphan pipeline_entries created in the batch import
-- Criteria: East Coast location, created on 2026-01-19, created_by IS NULL
-- This is reversible - data is NOT deleted, just marked as deleted

UPDATE pipeline_entries
SET 
  is_deleted = true,
  deleted_at = NOW(),
  updated_at = NOW()
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6'  -- East Coast
  AND created_by IS NULL
  AND created_at::date = '2026-01-19'
  AND is_deleted = false;

-- Step 1: Delete duplicate stages keeping the one with the lowest id per (tenant_id, name)
DELETE FROM pipeline_stages 
WHERE id NOT IN (
  SELECT DISTINCT ON (tenant_id, name) id 
  FROM pipeline_stages 
  ORDER BY tenant_id, name, id
)
AND key IS NULL;

-- Step 2: Auto-generate keys for all remaining NULL keys
UPDATE pipeline_stages 
SET key = lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9\s]', '', 'g'), '\s+', '_', 'g'))
WHERE key IS NULL;

-- Step 3: Override Tristate's keys with correct mappings matching existing entry statuses
UPDATE pipeline_stages SET key = 'lead' WHERE id = 'eb2fbeb4-f7fa-48d8-a783-a8abb9f02718';
UPDATE pipeline_stages SET key = 'project' WHERE id = '59d194f8-7714-49bd-afdd-ac01ef6db493';
UPDATE pipeline_stages SET key = 'completed' WHERE id = '1bf447e2-5681-4b28-ad7e-d3f5e67e59e8';

-- Step 4: Add NOT NULL constraint
ALTER TABLE pipeline_stages ALTER COLUMN key SET NOT NULL;
ALTER TABLE pipeline_stages ALTER COLUMN key SET DEFAULT '';

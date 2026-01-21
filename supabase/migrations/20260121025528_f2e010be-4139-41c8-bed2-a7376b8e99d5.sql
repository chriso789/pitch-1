-- Step 1: Deduplicate rows with normalized_address_key = '_' or empty/null
-- Keep only the first (oldest) row per tenant for invalid keys
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, normalized_address_key
      ORDER BY created_at ASC NULLS LAST
    ) as rn
  FROM canvassiq_properties
  WHERE normalized_address_key IS NULL 
    OR normalized_address_key = '' 
    OR normalized_address_key = '_'
)
DELETE FROM canvassiq_properties 
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 2: Set null for invalid keys so they don't conflict
-- (NULLs are always unique in PostgreSQL unique constraints)
UPDATE canvassiq_properties
SET normalized_address_key = NULL
WHERE normalized_address_key = '' OR normalized_address_key = '_';

-- Step 3: Clean up any remaining duplicates on valid keys
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, normalized_address_key
      ORDER BY created_at ASC NULLS LAST
    ) as rn
  FROM canvassiq_properties
  WHERE normalized_address_key IS NOT NULL
)
DELETE FROM canvassiq_properties 
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 4: Add the unique constraint
ALTER TABLE canvassiq_properties
ADD CONSTRAINT uq_canvassiq_tenant_address UNIQUE (tenant_id, normalized_address_key);

-- Step 5: Recreate index for query performance
CREATE INDEX IF NOT EXISTS idx_canvassiq_address_lookup 
ON canvassiq_properties (tenant_id, normalized_address_key)
WHERE normalized_address_key IS NOT NULL;
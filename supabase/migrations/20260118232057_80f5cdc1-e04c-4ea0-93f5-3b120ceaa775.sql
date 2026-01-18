-- Fix: Drop the existing index first, delete duplicates, then recreate

-- Step 1: Drop existing unique index so we can modify data
DROP INDEX IF EXISTS idx_canvassiq_unique_address_per_tenant;

-- Step 2: Delete duplicates (keeping best record per address)
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, normalized_address_key
      ORDER BY 
        building_snapped DESC NULLS LAST,
        created_at ASC NULLS LAST
    ) as rn
  FROM canvassiq_properties
  WHERE normalized_address_key IS NOT NULL
    AND normalized_address_key != ''
    AND normalized_address_key != '_'
)
DELETE FROM canvassiq_properties 
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 3: Recreate unique index
CREATE UNIQUE INDEX idx_canvassiq_unique_address_per_tenant 
ON canvassiq_properties (tenant_id, normalized_address_key)
WHERE normalized_address_key IS NOT NULL 
  AND normalized_address_key != '' 
  AND normalized_address_key != '_';
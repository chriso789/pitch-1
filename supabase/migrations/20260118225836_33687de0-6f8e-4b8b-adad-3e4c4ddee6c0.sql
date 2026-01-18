-- Clean up duplicate properties in canvassiq_properties
-- This removes duplicate markers caused by multiple lots with same street address

-- First, add normalized_address_key column if it doesn't exist
ALTER TABLE canvassiq_properties 
ADD COLUMN IF NOT EXISTS normalized_address_key TEXT;

-- Update existing rows to populate normalized_address_key
UPDATE canvassiq_properties
SET normalized_address_key = LOWER(
  COALESCE(address->>'street_number', '') || '_' || 
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              COALESCE(address->>'street_name', address->>'street', ''),
              'Street', 'St', 'gi'),
            'Avenue', 'Ave', 'gi'),
          'Boulevard', 'Blvd', 'gi'),
        'Drive', 'Dr', 'gi'),
      'Road', 'Rd', 'gi'),
    'Lane', 'Ln', 'gi')
)
WHERE normalized_address_key IS NULL;

-- Delete duplicates, keeping only the earliest created record for each address
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, normalized_address_key
      ORDER BY created_at ASC NULLS LAST
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

-- Create unique index to prevent future duplicates
-- Using a partial index to only enforce uniqueness on valid addresses
DROP INDEX IF EXISTS idx_canvassiq_unique_address_per_tenant;
CREATE UNIQUE INDEX idx_canvassiq_unique_address_per_tenant 
ON canvassiq_properties (tenant_id, normalized_address_key)
WHERE normalized_address_key IS NOT NULL 
  AND normalized_address_key != '' 
  AND normalized_address_key != '_';
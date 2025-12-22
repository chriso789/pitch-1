-- Soft-delete duplicate contacts, keeping the oldest record for each unique address
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(address_street)), LOWER(TRIM(address_city)), LOWER(TRIM(address_state)), LOWER(TRIM(address_zip)), tenant_id
      ORDER BY created_at ASC
    ) as rn
  FROM contacts 
  WHERE is_deleted = false
)
UPDATE contacts 
SET is_deleted = true, updated_at = NOW()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
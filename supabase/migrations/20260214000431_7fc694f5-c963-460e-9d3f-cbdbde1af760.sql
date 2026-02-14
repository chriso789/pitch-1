-- Step 1: Re-link pipeline entries from duplicate contacts to primary (oldest) contact
WITH dupes AS (
  SELECT phone, tenant_id,
         (array_agg(id ORDER BY created_at))[1] AS primary_id,
         array_agg(id ORDER BY created_at) AS all_ids
  FROM contacts
  WHERE phone IS NOT NULL AND phone != '' AND is_deleted = false
  GROUP BY phone, tenant_id
  HAVING COUNT(*) > 1
)
UPDATE pipeline_entries pe
SET contact_id = d.primary_id
FROM dupes d
WHERE pe.contact_id = ANY(d.all_ids[2:])
  AND pe.contact_id != d.primary_id;

-- Step 2: Soft-delete the duplicate contact records (keep the oldest/primary)
WITH dupes AS (
  SELECT phone, tenant_id,
         (array_agg(id ORDER BY created_at))[1] AS primary_id,
         array_agg(id ORDER BY created_at) AS all_ids
  FROM contacts
  WHERE phone IS NOT NULL AND phone != '' AND is_deleted = false
  GROUP BY phone, tenant_id
  HAVING COUNT(*) > 1
),
dupe_ids AS (
  SELECT unnest(all_ids[2:]) AS id FROM dupes
)
UPDATE contacts
SET is_deleted = true
WHERE id IN (SELECT id FROM dupe_ids);
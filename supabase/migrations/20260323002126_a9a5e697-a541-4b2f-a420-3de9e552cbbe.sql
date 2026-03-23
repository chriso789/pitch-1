-- Migrate contacts FK references from old-format duplicate properties to their canonical counterparts,
-- then delete the old duplicates and clear poisoned 4063 data.

-- Step 1: Update contacts to point to the canonical (newer) property row
UPDATE contacts
SET canvassiq_property_id = new_row.id
FROM canvassiq_properties old
JOIN canvassiq_properties new_row
  ON old.tenant_id = new_row.tenant_id
  AND old.normalized_address_key != new_row.normalized_address_key
  AND replace(old.normalized_address_key, '_', '') = replace(new_row.normalized_address_key, '_', '')
  AND length(new_row.normalized_address_key) > length(old.normalized_address_key)
WHERE contacts.canvassiq_property_id = old.id
  AND old.created_at <= new_row.created_at;

-- Step 2: Delete old-format duplicates where a canonical counterpart exists
DELETE FROM canvassiq_properties
WHERE id IN (
  SELECT old.id
  FROM canvassiq_properties old
  JOIN canvassiq_properties new_row
    ON old.tenant_id = new_row.tenant_id
    AND old.normalized_address_key != new_row.normalized_address_key
    AND replace(old.normalized_address_key, '_', '') = replace(new_row.normalized_address_key, '_', '')
    AND length(new_row.normalized_address_key) > length(old.normalized_address_key)
  WHERE old.created_at <= new_row.created_at
);

-- Step 3: Clear poisoned owner/enrichment data on the 4063 Fonsica row(s)
UPDATE canvassiq_properties 
SET owner_name = NULL, 
    property_data = jsonb_build_object('repair_note', 'Cleared poisoned neighbor data v2', 'repaired_at', now()::text),
    searchbug_data = NULL, 
    phone_numbers = NULL, 
    emails = NULL, 
    enrichment_last_at = NULL, 
    updated_at = now() 
WHERE normalized_address_key IN ('4063_fonsica_ave', '4063_fonsicaave');
-- Backfill city/state/zip from formatted address for existing properties
UPDATE canvassiq_properties
SET address = address || jsonb_build_object(
  'city', split_part(address->>'formatted', ', ', 2),
  'state', split_part(split_part(address->>'formatted', ', ', 3), ' ', 1),
  'zip', regexp_replace(split_part(address->>'formatted', ', ', 3), '[^0-9]', '', 'g')
)
WHERE (address->>'city' IS NULL OR address->>'city' = '')
  AND address->>'formatted' IS NOT NULL;
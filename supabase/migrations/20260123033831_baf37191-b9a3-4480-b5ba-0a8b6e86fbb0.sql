-- Step 1: Create pipeline_entries for orphaned contacts with 'qualified' status
INSERT INTO pipeline_entries (
  id,
  tenant_id,
  contact_id,
  location_id,
  status,
  priority,
  is_deleted,
  created_at,
  updated_at
)
SELECT 
  gen_random_uuid(),
  c.tenant_id,
  c.id,
  c.location_id,
  'lead',
  'medium',
  false,
  NOW(),
  NOW()
FROM contacts c
LEFT JOIN locations l ON c.location_id = l.id
WHERE c.qualification_status = 'qualified'
  AND (l.name ILIKE '%east%' OR l.name ILIKE '%west%')
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_entries pe 
    WHERE pe.contact_id = c.id AND pe.is_deleted = false
  );

-- Step 2: Update contact qualification_status to 'lead' to match pipeline
UPDATE contacts c
SET 
  qualification_status = 'lead',
  updated_at = NOW()
FROM locations l
WHERE c.location_id = l.id
  AND c.qualification_status = 'qualified'
  AND (l.name ILIKE '%east%' OR l.name ILIKE '%west%');
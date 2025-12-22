-- ============================================================================
-- CONTACT RENUMBERING MIGRATION
-- Removes gaps in contact_number sequence and updates all related records
-- ============================================================================

-- Phase 1: Create audit table to track all changes
CREATE TABLE IF NOT EXISTS public.contact_renumber_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL,
  old_contact_number TEXT,
  new_contact_number TEXT,
  old_clj_formatted TEXT,
  new_clj_formatted TEXT,
  table_name TEXT NOT NULL DEFAULT 'contacts',
  migrated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 2: Log current state before changes (contacts)
INSERT INTO contact_renumber_audit (contact_id, old_contact_number, old_clj_formatted, table_name)
SELECT id, contact_number, clj_formatted_number, 'contacts'
FROM contacts;

-- Phase 3: Renumber all contacts sequentially based on creation order
WITH numbered AS (
  SELECT 
    id, 
    contact_number as old_number,
    ROW_NUMBER() OVER (ORDER BY created_at, id) as new_number
  FROM contacts
)
UPDATE contacts c
SET 
  contact_number = numbered.new_number::TEXT,
  clj_formatted_number = numbered.new_number::TEXT || '-0-0',
  updated_at = NOW()
FROM numbered 
WHERE c.id = numbered.id;

-- Phase 4: Update audit table with new values
UPDATE contact_renumber_audit cra
SET new_contact_number = c.contact_number,
    new_clj_formatted = c.clj_formatted_number
FROM contacts c
WHERE cra.contact_id = c.id AND cra.table_name = 'contacts';

-- Phase 5: Log pipeline_entries before update
INSERT INTO contact_renumber_audit (contact_id, old_contact_number, old_clj_formatted, table_name)
SELECT 
  pe.contact_id,
  pe.contact_number::TEXT,
  pe.clj_formatted_number,
  'pipeline_entries'
FROM pipeline_entries pe
WHERE pe.contact_id IS NOT NULL;

-- Phase 6: Update pipeline_entries with new contact numbers
UPDATE pipeline_entries pe
SET 
  contact_number = c.contact_number::INTEGER,
  clj_formatted_number = c.contact_number || '-' || COALESCE(pe.lead_number, 0)::TEXT || '-0',
  updated_at = NOW()
FROM contacts c 
WHERE pe.contact_id = c.id;

-- Phase 7: Update audit for pipeline_entries
UPDATE contact_renumber_audit cra
SET new_contact_number = pe.contact_number::TEXT,
    new_clj_formatted = pe.clj_formatted_number
FROM pipeline_entries pe
WHERE cra.contact_id = pe.contact_id 
  AND cra.table_name = 'pipeline_entries'
  AND cra.new_contact_number IS NULL;

-- Phase 8: Log projects before update  
INSERT INTO contact_renumber_audit (contact_id, old_contact_number, old_clj_formatted, table_name)
SELECT 
  pe.contact_id,
  p.contact_number::TEXT,
  p.clj_formatted_number,
  'projects'
FROM projects p
JOIN pipeline_entries pe ON p.pipeline_entry_id = pe.id
WHERE pe.contact_id IS NOT NULL;

-- Phase 9: Update projects with new contact numbers
UPDATE projects p
SET 
  contact_number = c.contact_number::INTEGER,
  clj_formatted_number = c.contact_number || '-' || COALESCE(p.lead_number, 0)::TEXT || '-' || COALESCE(p.job_number, 0)::TEXT,
  updated_at = NOW()
FROM contacts c
JOIN pipeline_entries pe ON pe.contact_id = c.id
WHERE p.pipeline_entry_id = pe.id;

-- Phase 10: Update audit for projects
UPDATE contact_renumber_audit cra
SET new_contact_number = p.contact_number::TEXT,
    new_clj_formatted = p.clj_formatted_number
FROM projects p
JOIN pipeline_entries pe ON p.pipeline_entry_id = pe.id
WHERE cra.contact_id = pe.contact_id 
  AND cra.table_name = 'projects'
  AND cra.new_contact_number IS NULL;

-- Add index for audit lookups
CREATE INDEX IF NOT EXISTS idx_contact_renumber_audit_contact_id 
ON contact_renumber_audit(contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_renumber_audit_table_name 
ON contact_renumber_audit(table_name);
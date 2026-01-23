-- =============================================================
-- BIDIRECTIONAL SYNC: Contact qualification_status → Pipeline
-- =============================================================

-- Step 1: Create trigger function that syncs contact status to pipeline
CREATE OR REPLACE FUNCTION sync_contact_status_to_pipeline()
RETURNS TRIGGER AS $$
DECLARE
  next_lead_number INT;
BEGIN
  -- When contact is marked qualified or interested, ensure pipeline entry exists
  IF NEW.qualification_status IN ('qualified', 'interested') THEN
    -- Check if pipeline entry already exists for this contact
    IF NOT EXISTS (
      SELECT 1 FROM pipeline_entries 
      WHERE contact_id = NEW.id AND is_deleted = false
    ) THEN
      -- Get next lead number for this tenant
      SELECT COALESCE(MAX(lead_number), 0) + 1 INTO next_lead_number
      FROM pipeline_entries 
      WHERE tenant_id = NEW.tenant_id;
      
      -- Create new pipeline entry with status = 'lead' (first pipeline stage)
      INSERT INTO pipeline_entries (
        id, tenant_id, contact_id, location_id, status, priority, 
        lead_number, is_deleted, created_at, updated_at
      )
      VALUES (
        gen_random_uuid(),
        NEW.tenant_id,
        NEW.id,
        NEW.location_id,
        'lead',  -- Start at first pipeline stage (New Lead)
        'medium',
        next_lead_number,
        false,
        NOW(),
        NOW()
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Create trigger on contacts table
DROP TRIGGER IF EXISTS sync_contact_to_pipeline ON contacts;
CREATE TRIGGER sync_contact_to_pipeline
AFTER UPDATE OF qualification_status ON contacts
FOR EACH ROW
WHEN (NEW.qualification_status IS DISTINCT FROM OLD.qualification_status)
EXECUTE FUNCTION sync_contact_status_to_pipeline();

-- Step 3: Also trigger on INSERT for new contacts with qualified/interested status
DROP TRIGGER IF EXISTS sync_new_contact_to_pipeline ON contacts;
CREATE TRIGGER sync_new_contact_to_pipeline
AFTER INSERT ON contacts
FOR EACH ROW
WHEN (NEW.qualification_status IN ('qualified', 'interested'))
EXECUTE FUNCTION sync_contact_status_to_pipeline();

-- =============================================================
-- DATA FIX: Create pipeline entries for existing qualified/interested contacts
-- in O'Brien Contracting's East/West Coast locations
-- =============================================================

-- Step 4: Create pipeline entries for qualified/interested contacts missing them
INSERT INTO pipeline_entries (
  id, tenant_id, contact_id, location_id, status, priority, 
  lead_number, is_deleted, created_at, updated_at
)
SELECT 
  gen_random_uuid(),
  c.tenant_id,
  c.id,
  c.location_id,
  'lead',
  'medium',
  ROW_NUMBER() OVER (PARTITION BY c.tenant_id ORDER BY c.created_at)::INT + 
    COALESCE((SELECT MAX(lead_number) FROM pipeline_entries WHERE tenant_id = c.tenant_id), 0),
  false,
  NOW(),
  NOW()
FROM contacts c
WHERE c.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'  -- O'Brien Contracting
  AND c.location_id IN (
    'acb2ee85-d4f7-4a4e-9b97-cd421554b8af',  -- East Coast
    'a3615f0d-c7b7-4ee9-a568-a71508a539c6',  -- East Coast (alternate)
    'c490231c-2a0e-4afc-8412-672e1c890c16'   -- West Coast
  )
  AND c.qualification_status IN ('qualified', 'interested')
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_entries pe 
    WHERE pe.contact_id = c.id AND pe.is_deleted = false
  );
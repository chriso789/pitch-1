-- Phase 1: Immediate Data Fix - Sync all pipeline statuses to contacts
UPDATE contacts c
SET 
  qualification_status = pe.status,
  updated_at = NOW()
FROM pipeline_entries pe
WHERE pe.contact_id = c.id
  AND pe.is_deleted = false
  AND (c.qualification_status IS NULL OR c.qualification_status != pe.status)
  AND pe.status IN ('lead', 'qualified', 'contingency_signed', 'legal_review', 'ready_for_approval', 'project', 'completed');

-- Phase 2: Create trigger function to sync pipeline status changes to contact
CREATE OR REPLACE FUNCTION sync_pipeline_status_to_contact()
RETURNS TRIGGER AS $$
BEGIN
  -- When pipeline entry status changes, update the linked contact
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.contact_id IS NOT NULL THEN
    UPDATE contacts
    SET 
      qualification_status = NEW.status,
      updated_at = NOW()
    WHERE id = NEW.contact_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on pipeline_entries UPDATE
DROP TRIGGER IF EXISTS sync_status_to_contact ON pipeline_entries;
CREATE TRIGGER sync_status_to_contact
AFTER UPDATE OF status ON pipeline_entries
FOR EACH ROW
EXECUTE FUNCTION sync_pipeline_status_to_contact();
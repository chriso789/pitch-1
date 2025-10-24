-- Fix job number assignment trigger to use pipeline_entry_id
DROP TRIGGER IF EXISTS trigger_assign_job_number ON projects;
DROP FUNCTION IF EXISTS assign_job_number();

CREATE OR REPLACE FUNCTION assign_job_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contact_number INTEGER;
  v_lead_number INTEGER;
BEGIN
  -- Get contact and lead numbers from the related pipeline entry
  IF NEW.pipeline_entry_id IS NOT NULL THEN
    SELECT contact_number, lead_number INTO v_contact_number, v_lead_number
    FROM pipeline_entries
    WHERE id = NEW.pipeline_entry_id;
    
    NEW.contact_number := v_contact_number;
    NEW.lead_number := v_lead_number;
  END IF;
  
  IF NEW.job_number IS NULL AND NEW.contact_number IS NOT NULL AND NEW.lead_number IS NOT NULL THEN
    NEW.job_number := get_next_job_number(NEW.tenant_id, NEW.contact_number, NEW.lead_number);
  END IF;
  
  IF NEW.contact_number IS NOT NULL AND NEW.lead_number IS NOT NULL AND NEW.job_number IS NOT NULL THEN
    NEW.clj_formatted_number := format_clj_number(NEW.contact_number, NEW.lead_number, NEW.job_number);
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_assign_job_number
  BEFORE INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION assign_job_number();
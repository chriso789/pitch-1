-- Complete C-L-J system: Functions, triggers, and backfill

-- Trigger function for contacts
CREATE OR REPLACE FUNCTION trigger_assign_contact_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_number IS NULL THEN
    NEW.contact_number := get_next_contact_number(NEW.tenant_id);
    NEW.clj_formatted_number := format_clj_number(NEW.contact_number);
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger function for pipeline_entries
CREATE OR REPLACE FUNCTION trigger_assign_lead_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_number INTEGER;
BEGIN
  IF NEW.lead_number IS NULL AND NEW.contact_id IS NOT NULL THEN
    NEW.lead_number := get_next_lead_number(NEW.contact_id);
    SELECT contact_number INTO v_contact_number FROM contacts WHERE id = NEW.contact_id;
    NEW.clj_formatted_number := format_clj_number(v_contact_number, NEW.lead_number);
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger function for projects
CREATE OR REPLACE FUNCTION trigger_assign_job_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_number INTEGER;
  v_lead_number INTEGER;
BEGIN
  IF NEW.job_number IS NULL AND NEW.pipeline_entry_id IS NOT NULL THEN
    NEW.job_number := get_next_job_number(NEW.pipeline_entry_id);
    SELECT c.contact_number, pe.lead_number INTO v_contact_number, v_lead_number
    FROM pipeline_entries pe JOIN contacts c ON c.id = pe.contact_id
    WHERE pe.id = NEW.pipeline_entry_id;
    NEW.clj_formatted_number := format_clj_number(v_contact_number, v_lead_number, NEW.job_number);
  END IF;
  RETURN NEW;
END;
$$;

-- Create triggers
DROP TRIGGER IF EXISTS assign_contact_number ON contacts;
CREATE TRIGGER assign_contact_number BEFORE INSERT ON contacts FOR EACH ROW EXECUTE FUNCTION trigger_assign_contact_number();

DROP TRIGGER IF EXISTS assign_lead_number ON pipeline_entries;
CREATE TRIGGER assign_lead_number BEFORE INSERT ON pipeline_entries FOR EACH ROW EXECUTE FUNCTION trigger_assign_lead_number();

DROP TRIGGER IF EXISTS assign_job_number ON projects;
CREATE TRIGGER assign_job_number BEFORE INSERT ON projects FOR EACH ROW EXECUTE FUNCTION trigger_assign_job_number();

-- Backfill contacts
UPDATE contacts SET contact_number = sub.rn, clj_formatted_number = 'C-' || sub.rn
FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at) as rn FROM contacts WHERE contact_number IS NULL) sub
WHERE contacts.id = sub.id;

-- Backfill pipeline_entries  
UPDATE pipeline_entries pe SET lead_number = sub.lead_num, clj_formatted_number = 'C-' || sub.contact_number || '-L-' || sub.lead_num
FROM (SELECT pe2.id, c.contact_number, ROW_NUMBER() OVER (PARTITION BY pe2.contact_id ORDER BY pe2.created_at) as lead_num
FROM pipeline_entries pe2 JOIN contacts c ON c.id = pe2.contact_id WHERE pe2.lead_number IS NULL AND pe2.contact_id IS NOT NULL) sub
WHERE pe.id = sub.id;

-- Backfill projects
UPDATE projects p SET job_number = sub.job_num, clj_formatted_number = 'C-' || sub.contact_number || '-L-' || sub.lead_number || '-J-' || sub.job_num
FROM (SELECT p2.id, c.contact_number, pe.lead_number, ROW_NUMBER() OVER (PARTITION BY p2.pipeline_entry_id ORDER BY p2.created_at) as job_num
FROM projects p2 JOIN pipeline_entries pe ON pe.id = p2.pipeline_entry_id JOIN contacts c ON c.id = pe.contact_id
WHERE p2.job_number IS NULL AND p2.pipeline_entry_id IS NOT NULL) sub
WHERE p.id = sub.id;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_contacts_clj_formatted ON contacts(clj_formatted_number);
CREATE INDEX IF NOT EXISTS idx_pipeline_entries_clj_formatted ON pipeline_entries(clj_formatted_number);
CREATE INDEX IF NOT EXISTS idx_projects_clj_formatted ON projects(clj_formatted_number);
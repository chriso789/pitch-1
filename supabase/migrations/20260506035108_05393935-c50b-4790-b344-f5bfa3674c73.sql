
DROP INDEX IF EXISTS idx_contacts_unique_name_address;
DROP FUNCTION IF EXISTS public.format_clj_number(integer, integer, integer);
DROP FUNCTION IF EXISTS public.get_next_contact_number(UUID);

CREATE OR REPLACE FUNCTION public.format_clj_number(p_location_code TEXT, p_contact_num INTEGER, p_lead_num INTEGER, p_job_num INTEGER)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_location_code, 'XX') || '-' || LPAD(p_contact_num::TEXT, 4, '0') || '-' || LPAD(p_lead_num::TEXT, 2, '0') || '-' || LPAD(p_job_num::TEXT, 2, '0');
$$;

CREATE OR REPLACE FUNCTION public.get_next_contact_number(tenant_id_param UUID, location_id_param UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_number INTEGER; loc_id UUID;
BEGIN
  loc_id := location_id_param;
  IF loc_id IS NULL THEN SELECT id INTO loc_id FROM public.locations WHERE tenant_id = tenant_id_param AND is_primary = true LIMIT 1; END IF;
  UPDATE public.locations SET contact_sequence_counter = contact_sequence_counter + 1 WHERE id = loc_id RETURNING contact_sequence_counter INTO next_number;
  IF next_number IS NULL THEN
    SELECT COALESCE(MAX(contact_number::INTEGER), 0) + 1 INTO next_number FROM public.contacts WHERE tenant_id = tenant_id_param AND location_id = loc_id AND contact_number IS NOT NULL AND contact_number ~ '^\d+$';
  END IF;
  RETURN COALESCE(next_number, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_contact_number() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE loc_code TEXT;
BEGIN
  IF NEW.contact_number IS NULL THEN NEW.contact_number := public.get_next_contact_number(NEW.tenant_id, NEW.location_id)::TEXT; END IF;
  SELECT location_code INTO loc_code FROM public.locations WHERE id = NEW.location_id;
  NEW.clj_formatted_number := public.format_clj_number(COALESCE(loc_code, 'XX'), NEW.contact_number::INTEGER, 0, 0);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_lead_number() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE contact_num INTEGER; loc_code TEXT;
BEGIN
  SELECT c.contact_number::INTEGER, l.location_code INTO contact_num, loc_code FROM public.contacts c LEFT JOIN public.locations l ON l.id = c.location_id WHERE c.id = NEW.contact_id;
  IF NEW.lead_number IS NULL THEN NEW.lead_number := public.get_next_lead_number(NEW.contact_id)::TEXT; END IF;
  NEW.contact_number := contact_num;
  NEW.clj_formatted_number := public.format_clj_number(COALESCE(loc_code, 'XX'), COALESCE(contact_num, 0), NEW.lead_number::INTEGER, 0);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_job_number() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE contact_num INTEGER; lead_num INTEGER; loc_code TEXT;
BEGIN
  SELECT pe.contact_number, pe.lead_number::INTEGER, l.location_code INTO contact_num, lead_num, loc_code
  FROM public.pipeline_entries pe LEFT JOIN public.contacts c ON c.id = pe.contact_id LEFT JOIN public.locations l ON l.id = c.location_id WHERE pe.id = NEW.pipeline_entry_id;
  IF NEW.job_number IS NULL THEN NEW.job_number := public.get_next_job_number(NEW.pipeline_entry_id); END IF;
  NEW.contact_number := contact_num; NEW.lead_number := lead_num::TEXT;
  NEW.clj_formatted_number := public.format_clj_number(COALESCE(loc_code, 'XX'), COALESCE(contact_num, 0), COALESCE(lead_num, 0), COALESCE(NEW.job_number, 0));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_set_job_on_project_status() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE contact_num INTEGER; loc_code TEXT;
BEGIN
  IF NEW.status = 'project' AND (OLD.status IS NULL OR OLD.status != 'project') THEN
    IF NEW.clj_formatted_number IS NOT NULL AND NEW.clj_formatted_number ~ '-00$' THEN
      SELECT c.contact_number::INTEGER, l.location_code INTO contact_num, loc_code FROM public.contacts c LEFT JOIN public.locations l ON l.id = c.location_id WHERE c.id = NEW.contact_id;
      NEW.clj_formatted_number := public.format_clj_number(COALESCE(loc_code, 'XX'), COALESCE(contact_num, 0), COALESCE(NEW.lead_number::INTEGER, 0), 1);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_job_on_project ON public.pipeline_entries;
CREATE TRIGGER trg_auto_job_on_project BEFORE UPDATE ON public.pipeline_entries FOR EACH ROW EXECUTE FUNCTION public.auto_set_job_on_project_status();

-- Disable user triggers for bulk re-number
ALTER TABLE public.contacts DISABLE TRIGGER trg_check_contact_duplicate;
ALTER TABLE public.contacts DISABLE TRIGGER detect_duplicates_trigger;
ALTER TABLE public.contacts DISABLE TRIGGER assign_contact_number;
ALTER TABLE public.contacts DISABLE TRIGGER trigger_assign_contact_number;
ALTER TABLE public.contacts DISABLE TRIGGER audit_contacts;
ALTER TABLE public.contacts DISABLE TRIGGER audit_contacts_trigger;
ALTER TABLE public.contacts DISABLE TRIGGER auto_set_location_contacts;
ALTER TABLE public.contacts DISABLE TRIGGER ensure_contact_location;
ALTER TABLE public.contacts DISABLE TRIGGER log_ghost_activity;
ALTER TABLE public.contacts DISABLE TRIGGER trg_set_default_qualification_status;
ALTER TABLE public.contacts DISABLE TRIGGER update_contacts_updated_at;

DO $$
DECLARE loc RECORD; contact_rec RECORD; counter INTEGER;
BEGIN
  FOR loc IN SELECT id, location_code, tenant_id FROM public.locations WHERE location_code IS NOT NULL LOOP
    counter := 0;
    FOR contact_rec IN SELECT id FROM public.contacts WHERE location_id = loc.id AND tenant_id = loc.tenant_id ORDER BY created_at ASC LOOP
      counter := counter + 1;
      UPDATE public.contacts SET contact_number = counter::TEXT, clj_formatted_number = public.format_clj_number(loc.location_code, counter, 0, 0) WHERE id = contact_rec.id;
    END LOOP;
    UPDATE public.locations SET contact_sequence_counter = counter WHERE id = loc.id;
  END LOOP;
END $$;

ALTER TABLE public.contacts ENABLE TRIGGER trg_check_contact_duplicate;
ALTER TABLE public.contacts ENABLE TRIGGER detect_duplicates_trigger;
ALTER TABLE public.contacts ENABLE TRIGGER assign_contact_number;
ALTER TABLE public.contacts ENABLE TRIGGER trigger_assign_contact_number;
ALTER TABLE public.contacts ENABLE TRIGGER audit_contacts;
ALTER TABLE public.contacts ENABLE TRIGGER audit_contacts_trigger;
ALTER TABLE public.contacts ENABLE TRIGGER auto_set_location_contacts;
ALTER TABLE public.contacts ENABLE TRIGGER ensure_contact_location;
ALTER TABLE public.contacts ENABLE TRIGGER log_ghost_activity;
ALTER TABLE public.contacts ENABLE TRIGGER trg_set_default_qualification_status;
ALTER TABLE public.contacts ENABLE TRIGGER update_contacts_updated_at;

-- Pipeline entries
DO $$ DECLARE trig RECORD; BEGIN FOR trig IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.pipeline_entries'::regclass AND NOT tgisinternal LOOP EXECUTE format('ALTER TABLE public.pipeline_entries DISABLE TRIGGER %I', trig.tgname); END LOOP; END $$;

DO $$
DECLARE pe_rec RECORD; cnum INTEGER; lnum INTEGER; jnum INTEGER; loc_code TEXT;
BEGIN
  FOR pe_rec IN SELECT pe.id, pe.lead_number, pe.status, c.contact_number, c.location_id FROM public.pipeline_entries pe JOIN public.contacts c ON c.id = pe.contact_id WHERE c.contact_number IS NOT NULL LOOP
    cnum := COALESCE(pe_rec.contact_number::INTEGER, 0); lnum := COALESCE(pe_rec.lead_number::INTEGER, 0);
    SELECT location_code INTO loc_code FROM public.locations WHERE id = pe_rec.location_id;
    IF pe_rec.status IN ('project', 'completed', 'production', 'in_production') THEN jnum := 1; ELSE jnum := 0; END IF;
    UPDATE public.pipeline_entries SET contact_number = cnum, clj_formatted_number = public.format_clj_number(COALESCE(loc_code, 'XX'), cnum, lnum, jnum) WHERE id = pe_rec.id;
  END LOOP;
END $$;

DO $$ DECLARE trig RECORD; BEGIN FOR trig IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.pipeline_entries'::regclass AND NOT tgisinternal LOOP EXECUTE format('ALTER TABLE public.pipeline_entries ENABLE TRIGGER %I', trig.tgname); END LOOP; END $$;

-- Projects
DO $$ DECLARE trig RECORD; BEGIN FOR trig IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.projects'::regclass AND NOT tgisinternal LOOP EXECUTE format('ALTER TABLE public.projects DISABLE TRIGGER %I', trig.tgname); END LOOP; END $$;

DO $$
DECLARE proj_rec RECORD; cnum INTEGER; lnum INTEGER; loc_code TEXT;
BEGIN
  FOR proj_rec IN SELECT p.id, p.job_number, pe.contact_number, pe.lead_number, pe.contact_id FROM public.projects p JOIN public.pipeline_entries pe ON pe.id = p.pipeline_entry_id LOOP
    cnum := COALESCE(proj_rec.contact_number, 0); lnum := COALESCE(proj_rec.lead_number::INTEGER, 0);
    SELECT l.location_code INTO loc_code FROM public.contacts c JOIN public.locations l ON l.id = c.location_id WHERE c.id = proj_rec.contact_id;
    UPDATE public.projects SET clj_formatted_number = public.format_clj_number(COALESCE(loc_code, 'XX'), cnum, lnum, COALESCE(proj_rec.job_number, 1)) WHERE id = proj_rec.id;
  END LOOP;
END $$;

DO $$ DECLARE trig RECORD; BEGIN FOR trig IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.projects'::regclass AND NOT tgisinternal LOOP EXECUTE format('ALTER TABLE public.projects ENABLE TRIGGER %I', trig.tgname); END LOOP; END $$;

-- Phase 1 Day 2: C-L-J Automation - Functions, Triggers, and Backfill

-- ============================================
-- PART 1: Sequence Functions
-- ============================================

-- Get next contact number for tenant
CREATE OR REPLACE FUNCTION public.get_next_contact_number(tenant_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(contact_number), 0) + 1 INTO next_number
  FROM public.contacts
  WHERE tenant_id = tenant_id_param;
  
  RETURN next_number;
END;
$$;

-- Get next lead number for contact
CREATE OR REPLACE FUNCTION public.get_next_lead_number(contact_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(lead_number), 0) + 1 INTO next_number
  FROM public.pipeline_entries
  WHERE contact_id = contact_id_param;
  
  RETURN next_number;
END;
$$;

-- Get next job number for pipeline entry
CREATE OR REPLACE FUNCTION public.get_next_job_number(pipeline_entry_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(job_number), 0) + 1 INTO next_number
  FROM public.projects
  WHERE pipeline_entry_id = pipeline_entry_id_param;
  
  RETURN next_number;
END;
$$;

-- Format C-L-J number
CREATE OR REPLACE FUNCTION public.format_clj_number(
  contact_num INTEGER,
  lead_num INTEGER DEFAULT 0,
  job_num INTEGER DEFAULT 0
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN format('%s-%s-%s', contact_num, lead_num, job_num);
END;
$$;

-- ============================================
-- PART 2: Trigger Functions
-- ============================================

-- Auto-assign contact number
CREATE OR REPLACE FUNCTION public.assign_contact_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_number IS NULL THEN
    NEW.contact_number := public.get_next_contact_number(NEW.tenant_id);
  END IF;
  
  NEW.clj_formatted_number := public.format_clj_number(NEW.contact_number, 0, 0);
  
  RETURN NEW;
END;
$$;

-- Auto-assign lead number
CREATE OR REPLACE FUNCTION public.assign_lead_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  contact_num INTEGER;
BEGIN
  SELECT contact_number INTO contact_num
  FROM public.contacts
  WHERE id = NEW.contact_id;
  
  IF NEW.lead_number IS NULL THEN
    NEW.lead_number := public.get_next_lead_number(NEW.contact_id);
  END IF;
  
  NEW.contact_number := contact_num;
  NEW.clj_formatted_number := public.format_clj_number(contact_num, NEW.lead_number, 0);
  
  RETURN NEW;
END;
$$;

-- Auto-assign job number
CREATE OR REPLACE FUNCTION public.assign_job_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  contact_num INTEGER;
  lead_num INTEGER;
BEGIN
  SELECT 
    pe.contact_number,
    pe.lead_number
  INTO contact_num, lead_num
  FROM public.pipeline_entries pe
  WHERE pe.id = NEW.pipeline_entry_id;
  
  IF NEW.job_number IS NULL THEN
    NEW.job_number := public.get_next_job_number(NEW.pipeline_entry_id);
  END IF;
  
  NEW.contact_number := contact_num;
  NEW.lead_number := lead_num;
  NEW.clj_formatted_number := public.format_clj_number(contact_num, lead_num, NEW.job_number);
  
  RETURN NEW;
END;
$$;

-- ============================================
-- PART 3: Create Triggers
-- ============================================

DROP TRIGGER IF EXISTS trigger_assign_contact_number ON public.contacts;
CREATE TRIGGER trigger_assign_contact_number
  BEFORE INSERT ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_contact_number();

DROP TRIGGER IF EXISTS trigger_assign_lead_number ON public.pipeline_entries;
CREATE TRIGGER trigger_assign_lead_number
  BEFORE INSERT ON public.pipeline_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_lead_number();

DROP TRIGGER IF EXISTS trigger_assign_job_number ON public.projects;
CREATE TRIGGER trigger_assign_job_number
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_job_number();

-- ============================================
-- PART 4: Backfill Existing Records
-- ============================================

DO $$
DECLARE
  tenant_rec RECORD;
  contact_rec RECORD;
  lead_rec RECORD;
  project_rec RECORD;
  contact_counter INTEGER;
  lead_counter INTEGER;
  job_counter INTEGER;
BEGIN
  RAISE NOTICE 'Starting C-L-J backfill...';
  
  FOR tenant_rec IN SELECT DISTINCT tenant_id FROM public.contacts WHERE tenant_id IS NOT NULL LOOP
    contact_counter := 1;
    
    FOR contact_rec IN 
      SELECT id FROM public.contacts 
      WHERE tenant_id = tenant_rec.tenant_id 
      ORDER BY created_at, id
    LOOP
      UPDATE public.contacts
      SET 
        contact_number = contact_counter,
        clj_formatted_number = format_clj_number(contact_counter, 0, 0)
      WHERE id = contact_rec.id;
      
      lead_counter := 1;
      FOR lead_rec IN 
        SELECT id FROM public.pipeline_entries 
        WHERE contact_id = contact_rec.id 
        ORDER BY created_at, id
      LOOP
        UPDATE public.pipeline_entries
        SET 
          contact_number = contact_counter,
          lead_number = lead_counter,
          clj_formatted_number = format_clj_number(contact_counter, lead_counter, 0)
        WHERE id = lead_rec.id;
        
        job_counter := 1;
        FOR project_rec IN 
          SELECT id FROM public.projects 
          WHERE pipeline_entry_id = lead_rec.id 
          ORDER BY created_at, id
        LOOP
          UPDATE public.projects
          SET 
            contact_number = contact_counter,
            lead_number = lead_counter,
            job_number = job_counter,
            clj_formatted_number = format_clj_number(contact_counter, lead_counter, job_counter)
          WHERE id = project_rec.id;
          
          job_counter := job_counter + 1;
        END LOOP;
        
        lead_counter := lead_counter + 1;
      END LOOP;
      
      contact_counter := contact_counter + 1;
    END LOOP;
  END LOOP;
  
  RAISE NOTICE 'C-L-J backfill completed successfully';
END $$;
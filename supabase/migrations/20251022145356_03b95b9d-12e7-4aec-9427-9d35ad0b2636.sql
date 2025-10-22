-- Fix INTEGER/TEXT mismatch in trigger functions
-- pipeline_entries has INTEGER columns, so don't cast to TEXT

-- 1. Fix assign_lead_number trigger - remove TEXT casts
CREATE OR REPLACE FUNCTION public.assign_lead_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  contact_num INTEGER;
BEGIN
  -- Get contact number as INTEGER
  SELECT contact_number::INTEGER INTO contact_num
  FROM public.contacts
  WHERE id = NEW.contact_id;
  
  IF NEW.lead_number IS NULL THEN
    -- Keep as INTEGER for pipeline_entries table
    NEW.lead_number := public.get_next_lead_number(NEW.contact_id);
  END IF;
  
  -- Keep as INTEGER for pipeline_entries table
  NEW.contact_number := contact_num;
  -- Call format_clj_number with INTEGER values
  NEW.clj_formatted_number := public.format_clj_number(contact_num, NEW.lead_number, 0);
  
  RETURN NEW;
END;
$$;

-- 2. Fix assign_job_number trigger - keep INTEGERs from pipeline_entries, cast to TEXT for jobs
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
  -- Get contact and lead numbers as INTEGERs from pipeline_entries (no cast needed)
  SELECT pe.contact_number, pe.lead_number
  INTO contact_num, lead_num
  FROM public.pipeline_entries pe
  WHERE pe.id = NEW.pipeline_entry_id;
  
  IF NEW.job_number IS NULL THEN
    -- Cast to TEXT for jobs table (jobs has TEXT columns)
    NEW.job_number := public.get_next_job_number(NEW.pipeline_entry_id)::TEXT;
  END IF;
  
  -- Cast to TEXT for jobs table (jobs has TEXT columns)
  NEW.contact_number := contact_num::TEXT;
  NEW.lead_number := lead_num::TEXT;
  -- Call format_clj_number with INTEGER values
  NEW.clj_formatted_number := public.format_clj_number(contact_num, lead_num, NEW.job_number::INTEGER);
  
  RETURN NEW;
END;
$$;
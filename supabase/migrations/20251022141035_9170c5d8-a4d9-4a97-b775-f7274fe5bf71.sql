-- Fix trigger functions to cast TEXT to INTEGER when calling format_clj_number

-- 1. Fix assign_contact_number trigger
CREATE OR REPLACE FUNCTION public.assign_contact_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.contact_number IS NULL THEN
    NEW.contact_number := public.get_next_contact_number(NEW.tenant_id)::TEXT;
  END IF;
  
  -- Cast TEXT to INTEGER when calling format_clj_number
  NEW.clj_formatted_number := public.format_clj_number(NEW.contact_number::INTEGER, 0, 0);
  
  RETURN NEW;
END;
$$;

-- 2. Fix assign_lead_number trigger
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
    NEW.lead_number := public.get_next_lead_number(NEW.contact_id)::TEXT;
  END IF;
  
  NEW.contact_number := contact_num::TEXT;
  -- Cast TEXT to INTEGER when calling format_clj_number
  NEW.clj_formatted_number := public.format_clj_number(contact_num, NEW.lead_number::INTEGER, 0);
  
  RETURN NEW;
END;
$$;

-- 3. Fix assign_job_number trigger
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
  -- Get contact and lead numbers as INTEGERs
  SELECT pe.contact_number::INTEGER, pe.lead_number::INTEGER
  INTO contact_num, lead_num
  FROM public.pipeline_entries pe
  WHERE pe.id = NEW.pipeline_entry_id;
  
  IF NEW.job_number IS NULL THEN
    NEW.job_number := public.get_next_job_number(NEW.pipeline_entry_id)::TEXT;
  END IF;
  
  NEW.contact_number := contact_num::TEXT;
  NEW.lead_number := lead_num::TEXT;
  -- Cast TEXT to INTEGER when calling format_clj_number
  NEW.clj_formatted_number := public.format_clj_number(contact_num, lead_num, NEW.job_number::INTEGER);
  
  RETURN NEW;
END;
$$;
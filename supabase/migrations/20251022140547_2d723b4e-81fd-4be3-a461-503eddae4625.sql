-- Fix COALESCE type mismatch in C-L-J numbering functions
-- Drop existing functions first to avoid parameter name conflicts

DROP FUNCTION IF EXISTS public.get_next_contact_number(UUID);
DROP FUNCTION IF EXISTS public.get_next_lead_number(UUID);
DROP FUNCTION IF EXISTS public.get_next_job_number(UUID);

-- Recreate get_next_contact_number function with INTEGER casting
CREATE OR REPLACE FUNCTION public.get_next_contact_number(tenant_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- Cast contact_number (TEXT) to INTEGER before MAX/COALESCE
  SELECT COALESCE(MAX(contact_number::INTEGER), 0) + 1 INTO next_number
  FROM public.contacts
  WHERE tenant_id = tenant_id_param
    AND contact_number IS NOT NULL
    AND contact_number ~ '^\d+$'; -- Only include numeric values
  
  RETURN next_number;
END;
$$;

-- Recreate get_next_lead_number function with INTEGER casting
CREATE OR REPLACE FUNCTION public.get_next_lead_number(contact_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- Cast lead_number (TEXT) to INTEGER before MAX/COALESCE
  SELECT COALESCE(MAX(lead_number::INTEGER), 0) + 1 INTO next_number
  FROM public.pipeline_entries
  WHERE contact_id = contact_id_param
    AND lead_number IS NOT NULL
    AND lead_number ~ '^\d+$'; -- Only include numeric values
  
  RETURN next_number;
END;
$$;

-- Recreate get_next_job_number function with INTEGER casting
CREATE OR REPLACE FUNCTION public.get_next_job_number(lead_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- Cast job_number (TEXT) to INTEGER before MAX/COALESCE
  SELECT COALESCE(MAX(job_number::INTEGER), 0) + 1 INTO next_number
  FROM public.projects
  WHERE pipeline_entry_id = lead_id_param
    AND job_number IS NOT NULL
    AND job_number ~ '^\d+$'; -- Only include numeric values
  
  RETURN next_number;
END;
$$;
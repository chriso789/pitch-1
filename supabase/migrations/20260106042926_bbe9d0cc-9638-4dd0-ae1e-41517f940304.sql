-- Fix assign_job_number trigger to work with INTEGER job_number column
-- Remove the ::TEXT casts since job_number is INTEGER

CREATE OR REPLACE FUNCTION public.assign_job_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_number INTEGER;
  v_lead_number INTEGER;
  v_tenant_id UUID;
BEGIN
  -- Get tenant_id if not set on the project directly
  v_tenant_id := NEW.tenant_id;
  
  -- Get contact and lead numbers from the related pipeline entry
  IF NEW.pipeline_entry_id IS NOT NULL THEN
    SELECT pe.contact_number, pe.lead_number, pe.tenant_id 
    INTO v_contact_number, v_lead_number, v_tenant_id
    FROM pipeline_entries pe
    WHERE pe.id = NEW.pipeline_entry_id;
    
    -- Store these on the project record if columns exist
    NEW.contact_number := COALESCE(NEW.contact_number, v_contact_number);
    NEW.lead_number := COALESCE(NEW.lead_number, v_lead_number);
    NEW.tenant_id := COALESCE(NEW.tenant_id, v_tenant_id);
  END IF;
  
  -- Only try to generate job number if we don't have one
  IF NEW.job_number IS NULL THEN
    IF NEW.contact_number IS NOT NULL AND NEW.lead_number IS NOT NULL AND v_tenant_id IS NOT NULL THEN
      -- Use the 3-argument overload (returns INTEGER)
      NEW.job_number := get_next_job_number(v_tenant_id, NEW.contact_number, NEW.lead_number);
    ELSIF v_tenant_id IS NOT NULL THEN
      -- Fallback to simple auto-increment (returns INTEGER)
      NEW.job_number := generate_simple_job_number(v_tenant_id);
    ELSE
      -- Last resort: use a random number
      NEW.job_number := floor(random() * 10000 + 1)::INTEGER;
    END IF;
  END IF;
  
  -- Generate formatted CLJ number if we have all the pieces
  IF NEW.contact_number IS NOT NULL AND NEW.lead_number IS NOT NULL AND NEW.job_number IS NOT NULL THEN
    NEW.clj_formatted_number := format_clj_number(NEW.contact_number, NEW.lead_number, NEW.job_number);
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop the old TEXT-returning version of generate_simple_job_number (no args)
-- and replace with a version that returns INTEGER
DROP FUNCTION IF EXISTS public.generate_simple_job_number();

CREATE OR REPLACE FUNCTION public.generate_simple_job_number()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    next_num INTEGER;
BEGIN
    next_num := nextval('job_number_seq');
    RETURN next_num;
END;
$$;
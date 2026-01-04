-- Create overloaded function that accepts 3 arguments for job number generation
-- This fixes the mismatch where assign_job_number calls get_next_job_number with 3 args
CREATE OR REPLACE FUNCTION public.get_next_job_number(
  p_tenant_id UUID,
  p_contact_number INTEGER,
  p_lead_number INTEGER
) RETURNS INTEGER AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- Get the next job number for this specific contact/lead combination
  SELECT COALESCE(MAX(
    CASE 
      WHEN p.job_number ~ '^\d+$' THEN p.job_number::INTEGER 
      ELSE 0 
    END
  ), 0) + 1 INTO next_number
  FROM public.projects p
  JOIN public.pipeline_entries pe ON p.pipeline_entry_id = pe.id
  WHERE pe.tenant_id = p_tenant_id
    AND pe.contact_number = p_contact_number
    AND pe.lead_number = p_lead_number
    AND p.job_number IS NOT NULL;
  
  -- If no previous jobs or null result, start at 1
  IF next_number IS NULL OR next_number = 1 THEN
    next_number := 1;
  END IF;
  
  RETURN next_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a simple fallback job number generator for when contact/lead numbers are missing
CREATE OR REPLACE FUNCTION public.generate_simple_job_number(p_tenant_id UUID) 
RETURNS INTEGER AS $$
DECLARE
  next_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(
    CASE 
      WHEN p.job_number ~ '^\d+$' THEN p.job_number::INTEGER 
      ELSE 0 
    END
  ), 0) + 1 INTO next_number
  FROM public.projects p
  WHERE p.tenant_id = p_tenant_id
    AND p.job_number IS NOT NULL;
  
  IF next_number IS NULL THEN
    next_number := 1;
  END IF;
  
  RETURN next_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update assign_job_number trigger function with fallback logic
CREATE OR REPLACE FUNCTION public.assign_job_number() 
RETURNS TRIGGER AS $$
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
      -- Use the 3-argument overload for proper CLJ formatting
      NEW.job_number := get_next_job_number(v_tenant_id, NEW.contact_number, NEW.lead_number)::TEXT;
    ELSIF v_tenant_id IS NOT NULL THEN
      -- Fallback to simple auto-increment when contact/lead numbers are missing
      NEW.job_number := generate_simple_job_number(v_tenant_id)::TEXT;
    ELSE
      -- Last resort: use a random number
      NEW.job_number := floor(random() * 10000 + 1)::TEXT;
    END IF;
  END IF;
  
  -- Generate formatted CLJ number if we have all the pieces
  IF NEW.contact_number IS NOT NULL AND NEW.lead_number IS NOT NULL AND NEW.job_number IS NOT NULL THEN
    NEW.clj_formatted_number := format_clj_number(NEW.contact_number, NEW.lead_number, NEW.job_number::INTEGER);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
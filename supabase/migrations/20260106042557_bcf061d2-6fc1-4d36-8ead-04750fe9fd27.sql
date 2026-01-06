-- Fix job number functions to work with INTEGER column (remove regex operators)
-- The job_number column is INTEGER, not TEXT, so regex checks don't work

-- Function 1: get_next_job_number with 3 parameters
CREATE OR REPLACE FUNCTION public.get_next_job_number(
  p_tenant_id UUID,
  p_contact_number INTEGER,
  p_lead_number INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- job_number is already INTEGER, no need for regex checks or casting
  SELECT COALESCE(MAX(p.job_number), 0) + 1 INTO next_number
  FROM public.projects p
  WHERE p.tenant_id = p_tenant_id;
  
  RETURN next_number;
END;
$$;

-- Function 2: get_next_job_number with single UUID parameter
CREATE OR REPLACE FUNCTION public.get_next_job_number(lead_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_number INTEGER;
  v_tenant_id UUID;
BEGIN
  -- Get tenant_id from pipeline entry
  SELECT tenant_id INTO v_tenant_id
  FROM public.pipeline_entries
  WHERE id = lead_id_param;
  
  -- job_number is already INTEGER, no need for regex checks or casting
  SELECT COALESCE(MAX(job_number), 0) + 1 INTO next_number
  FROM public.projects
  WHERE tenant_id = v_tenant_id
    AND job_number IS NOT NULL;
  
  RETURN COALESCE(next_number, 1);
END;
$$;

-- Function 3: generate_simple_job_number
CREATE OR REPLACE FUNCTION public.generate_simple_job_number(p_tenant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- job_number is already INTEGER, no need for regex checks or casting
  SELECT COALESCE(MAX(p.job_number), 0) + 1 INTO next_number
  FROM public.projects p
  WHERE p.tenant_id = p_tenant_id;
  
  RETURN COALESCE(next_number, 1);
END;
$$;
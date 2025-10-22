-- Fix the get_next_lead_number function that has a type casting issue
-- The function was trying to use regex operator (~) on an INTEGER column

CREATE OR REPLACE FUNCTION public.get_next_lead_number(contact_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(lead_number), 0) + 1
  INTO next_number
  FROM public.pipeline_entries
  WHERE contact_id = contact_id_param
    AND lead_number IS NOT NULL;
  
  RETURN next_number;
END;
$$;

-- Now add the missing pipeline entry for Jared Janacek
INSERT INTO public.pipeline_entries (
  tenant_id,
  contact_id,
  status,
  priority,
  created_by,
  created_at,
  updated_at
)
SELECT 
  '14de934e-7964-4afd-940a-620d2ace125d'::uuid,
  '1451a289-704c-42c5-9c1a-faeb0f38d917'::uuid,
  'lead',
  'medium',
  c.created_by,
  c.created_at,
  c.created_at
FROM public.contacts c
WHERE c.id = '1451a289-704c-42c5-9c1a-faeb0f38d917'
  AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_entries pe 
    WHERE pe.contact_id = c.id
  );
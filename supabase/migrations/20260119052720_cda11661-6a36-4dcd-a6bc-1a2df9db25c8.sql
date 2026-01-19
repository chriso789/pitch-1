-- Drop and recreate the search function with location filtering and best-match scoring
DROP FUNCTION IF EXISTS public.search_contacts_and_jobs(UUID, TEXT, INT);

CREATE OR REPLACE FUNCTION public.search_contacts_and_jobs(
  p_tenant_id UUID,
  p_search_term TEXT,
  p_location_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  entity_type TEXT,
  entity_id UUID,
  entity_name TEXT,
  entity_subtext TEXT,
  clj_number TEXT,
  entity_status TEXT,
  match_score INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_term TEXT;
BEGIN
  -- Normalize search term
  normalized_term := LOWER(TRIM(p_search_term));
  
  IF LENGTH(normalized_term) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- Search contacts with scoring
  SELECT 
    'contact'::TEXT as entity_type,
    c.id as entity_id,
    COALESCE(NULLIF(TRIM(c.first_name || ' ' || COALESCE(c.last_name, '')), ''), c.company_name, 'Unknown Contact') as entity_name,
    COALESCE(c.address_street, c.email, c.phone, '') as entity_subtext,
    c.clj_number::TEXT as clj_number,
    COALESCE(c.status, 'active') as entity_status,
    -- Scoring: lower is better (prefix match on first_name = 1, last_name = 2, contains = 3, address/other = 4)
    CASE 
      WHEN LOWER(COALESCE(c.first_name, '')) LIKE normalized_term || '%' THEN 1
      WHEN LOWER(COALESCE(c.last_name, '')) LIKE normalized_term || '%' THEN 2
      WHEN LOWER(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) LIKE '%' || normalized_term || '%' THEN 3
      ELSE 4
    END as match_score
  FROM contacts c
  WHERE c.tenant_id = p_tenant_id
    AND (c.is_deleted IS NULL OR c.is_deleted = false)
    AND (p_location_id IS NULL OR c.location_id = p_location_id)
    AND (
      LOWER(COALESCE(c.first_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.last_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.company_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.email, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.phone, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.address_street, '')) LIKE '%' || normalized_term || '%'
      OR c.clj_number::TEXT LIKE '%' || normalized_term || '%'
    )
  
  UNION ALL
  
  -- Search jobs with scoring
  SELECT 
    'job'::TEXT as entity_type,
    j.id as entity_id,
    COALESCE(j.name, j.job_number, 'Unnamed Job') as entity_name,
    COALESCE(j.address, '') as entity_subtext,
    j.job_number as clj_number,
    COALESCE(j.status, 'active') as entity_status,
    CASE 
      WHEN LOWER(COALESCE(j.name, '')) LIKE normalized_term || '%' THEN 1
      WHEN j.job_number LIKE normalized_term || '%' THEN 2
      WHEN LOWER(COALESCE(j.name, '')) LIKE '%' || normalized_term || '%' THEN 3
      ELSE 4
    END as match_score
  FROM jobs j
  WHERE j.tenant_id = p_tenant_id
    AND (j.is_deleted IS NULL OR j.is_deleted = false)
    AND (p_location_id IS NULL OR j.location_id = p_location_id)
    AND (
      LOWER(COALESCE(j.name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(j.address, '')) LIKE '%' || normalized_term || '%'
      OR j.job_number LIKE '%' || normalized_term || '%'
    )
  
  ORDER BY match_score ASC, entity_name ASC
  LIMIT p_limit;
END;
$$;
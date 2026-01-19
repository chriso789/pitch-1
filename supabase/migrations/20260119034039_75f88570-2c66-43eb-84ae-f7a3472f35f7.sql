-- Create RPC function for universal search across contacts and jobs
CREATE OR REPLACE FUNCTION public.search_contacts_and_jobs(
  p_tenant_id UUID,
  p_search_term TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  entity_type TEXT,
  entity_id UUID,
  entity_name TEXT,
  entity_subtext TEXT,
  clj_number TEXT,
  entity_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  normalized_term TEXT;
BEGIN
  -- Normalize search term
  normalized_term := LOWER(TRIM(p_search_term));
  
  RETURN QUERY
  -- Search contacts
  SELECT 
    'contact'::TEXT as entity_type,
    c.id as entity_id,
    COALESCE(c.first_name || ' ' || c.last_name, c.company_name, 'Unknown')::TEXT as entity_name,
    COALESCE(c.address_city || ', ' || c.address_state, c.email, c.phone)::TEXT as entity_subtext,
    COALESCE(c.clj_number::TEXT, '') as clj_number,
    COALESCE(c.type::TEXT, 'contact') as entity_status
  FROM contacts c
  WHERE c.tenant_id = p_tenant_id
    AND (c.is_deleted IS NULL OR c.is_deleted = false)
    AND (
      LOWER(c.first_name) LIKE normalized_term || '%'
      OR LOWER(c.last_name) LIKE normalized_term || '%'
      OR LOWER(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.company_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.email, '')) LIKE '%' || normalized_term || '%'
      OR COALESCE(c.phone, '') LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.address_street, '')) LIKE '%' || normalized_term || '%'
      OR COALESCE(c.clj_number::TEXT, '') LIKE '%' || normalized_term || '%'
    )
  
  UNION ALL
  
  -- Search jobs
  SELECT 
    'job'::TEXT as entity_type,
    j.id as entity_id,
    COALESCE(j.name, j.job_number, 'Unnamed Job')::TEXT as entity_name,
    COALESCE(j.address_street, cont.first_name || ' ' || cont.last_name)::TEXT as entity_subtext,
    COALESCE(j.job_number, '') as clj_number,
    COALESCE(j.status::TEXT, 'unknown') as entity_status
  FROM jobs j
  LEFT JOIN contacts cont ON j.contact_id = cont.id
  WHERE j.tenant_id = p_tenant_id
    AND (j.is_deleted IS NULL OR j.is_deleted = false)
    AND (
      LOWER(COALESCE(j.name, '')) LIKE '%' || normalized_term || '%'
      OR COALESCE(j.job_number, '') LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(j.address_street, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(cont.first_name, '')) LIKE normalized_term || '%'
      OR LOWER(COALESCE(cont.last_name, '')) LIKE normalized_term || '%'
      OR LOWER(COALESCE(cont.first_name, '') || ' ' || COALESCE(cont.last_name, '')) LIKE '%' || normalized_term || '%'
    )
  
  ORDER BY entity_name
  LIMIT p_limit;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.search_contacts_and_jobs(UUID, TEXT, INT) TO authenticated;
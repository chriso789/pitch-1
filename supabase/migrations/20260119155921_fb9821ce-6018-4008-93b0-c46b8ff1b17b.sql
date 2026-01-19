-- Drop all existing versions of the function to resolve overload conflict
DROP FUNCTION IF EXISTS search_contacts_and_jobs(UUID, TEXT, INTEGER, UUID);
DROP FUNCTION IF EXISTS search_contacts_and_jobs(UUID, TEXT, UUID, INTEGER);

-- Recreate with corrected jobs query (no j.address, no j.location_id)
CREATE OR REPLACE FUNCTION search_contacts_and_jobs(
  p_tenant_id UUID,
  p_search_term TEXT,
  p_limit INTEGER DEFAULT 20,
  p_location_id UUID DEFAULT NULL
)
RETURNS TABLE (
  entity_type TEXT,
  entity_id UUID,
  entity_name TEXT,
  entity_subtext TEXT,
  clj_number TEXT,
  entity_status TEXT,
  match_score INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_term TEXT;
BEGIN
  normalized_term := LOWER(TRIM(p_search_term));
  
  IF LENGTH(normalized_term) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- CONTACTS query (unchanged - contacts has location_id)
  SELECT 
    'contact'::TEXT as entity_type,
    c.id as entity_id,
    COALESCE(NULLIF(TRIM(c.first_name || ' ' || COALESCE(c.last_name, '')), ''), 
             c.company_name, 'Unknown Contact') as entity_name,
    COALESCE(c.address_street, c.email, c.phone, '') as entity_subtext,
    c.clj_number::TEXT as clj_number,
    COALESCE(c.qualification_status, 'active') as entity_status,
    CASE 
      WHEN LOWER(COALESCE(c.first_name, '')) LIKE normalized_term || '%' THEN 1
      WHEN LOWER(COALESCE(c.last_name, '')) LIKE normalized_term || '%' THEN 2
      WHEN LOWER(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) 
           LIKE '%' || normalized_term || '%' THEN 3
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
  
  -- JOBS query (fixed - use address_street, filter location via pipeline_entries or contact)
  SELECT 
    'job'::TEXT as entity_type,
    j.id as entity_id,
    COALESCE(j.name, j.job_number, 'Unnamed Job') as entity_name,
    COALESCE(
      NULLIF(CONCAT_WS(', ', jc.address_street, jc.address_city, jc.address_state), ''),
      j.address_street,
      ''
    ) as entity_subtext,
    j.job_number as clj_number,
    COALESCE(j.status, 'active') as entity_status,
    CASE 
      WHEN LOWER(COALESCE(j.name, '')) LIKE normalized_term || '%' THEN 1
      WHEN j.job_number LIKE normalized_term || '%' THEN 2
      WHEN LOWER(COALESCE(j.name, '')) LIKE '%' || normalized_term || '%' THEN 3
      ELSE 4
    END as match_score
  FROM jobs j
  LEFT JOIN pipeline_entries pe ON pe.id = j.pipeline_entry_id AND pe.tenant_id = p_tenant_id
  LEFT JOIN contacts jc ON jc.id = j.contact_id AND jc.tenant_id = p_tenant_id
  WHERE j.tenant_id = p_tenant_id
    AND (j.is_deleted IS NULL OR j.is_deleted = false)
    AND (
      p_location_id IS NULL 
      OR COALESCE(pe.location_id, jc.location_id) = p_location_id
    )
    AND (
      LOWER(COALESCE(j.name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(j.address_street, '')) LIKE '%' || normalized_term || '%'
      OR j.job_number LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(jc.first_name, '') || ' ' || COALESCE(jc.last_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(jc.address_street, '')) LIKE '%' || normalized_term || '%'
    )
  
  ORDER BY match_score ASC, entity_name ASC
  LIMIT p_limit;
END;
$$;
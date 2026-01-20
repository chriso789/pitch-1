-- Update search_contacts_and_jobs RPC to include pipeline_entries (leads)
CREATE OR REPLACE FUNCTION public.search_contacts_and_jobs(
  p_tenant_id UUID,
  p_search_term TEXT,
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
  -- CONTACTS
  SELECT 
    'contact'::TEXT as entity_type,
    c.id as entity_id,
    COALESCE(NULLIF(TRIM(c.first_name || ' ' || COALESCE(c.last_name, '')), ''), c.company_name, 'Unknown') as entity_name,
    COALESCE(c.address_street, c.email, '') as entity_subtext,
    NULL::TEXT as clj_number,
    COALESCE(c.qualification_status, 'unknown') as entity_status,
    CASE 
      WHEN LOWER(COALESCE(c.first_name, '')) LIKE normalized_term || '%' THEN 1
      WHEN LOWER(COALESCE(c.last_name, '')) LIKE normalized_term || '%' THEN 2
      WHEN LOWER(COALESCE(c.company_name, '')) LIKE normalized_term || '%' THEN 3
      ELSE 4
    END as match_score
  FROM contacts c
  WHERE c.tenant_id = p_tenant_id
    AND c.is_deleted = false
    AND (
      p_location_id IS NULL 
      OR c.location_id = p_location_id 
      OR (c.location_id IS NULL AND c.created_by = auth.uid())
    )
    AND (
      LOWER(COALESCE(c.first_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.last_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.company_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.email, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.address_street, '')) LIKE '%' || normalized_term || '%'
    )

  UNION ALL

  -- LEADS (pipeline_entries)
  SELECT 
    'lead'::TEXT as entity_type,
    pe.id as entity_id,
    COALESCE(NULLIF(TRIM(c.first_name || ' ' || COALESCE(c.last_name, '')), ''), c.company_name, 'Unknown Lead') as entity_name,
    COALESCE(c.address_street, c.email, '') as entity_subtext,
    pe.clj_formatted_number as clj_number,
    COALESCE(pe.status::TEXT, 'lead') as entity_status,
    CASE 
      WHEN LOWER(COALESCE(c.first_name, '')) LIKE normalized_term || '%' THEN 1
      WHEN LOWER(COALESCE(c.last_name, '')) LIKE normalized_term || '%' THEN 2
      WHEN pe.clj_formatted_number LIKE '%' || normalized_term || '%' THEN 3
      ELSE 4
    END as match_score
  FROM pipeline_entries pe
  JOIN contacts c ON c.id = pe.contact_id
  WHERE pe.tenant_id = p_tenant_id
    AND pe.is_deleted = false
    AND (
      p_location_id IS NULL 
      OR pe.location_id = p_location_id 
      OR (pe.location_id IS NULL AND pe.created_by = auth.uid())
    )
    AND (
      LOWER(COALESCE(c.first_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.last_name, '')) LIKE '%' || normalized_term || '%'
      OR pe.clj_formatted_number LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(c.address_street, '')) LIKE '%' || normalized_term || '%'
    )

  UNION ALL

  -- JOBS
  SELECT 
    'job'::TEXT as entity_type,
    j.id as entity_id,
    COALESCE(j.name, j.clj_formatted_number, 'Unnamed Job') as entity_name,
    COALESCE(jc.address_street, jc.first_name || ' ' || COALESCE(jc.last_name, ''), '') as entity_subtext,
    j.clj_formatted_number as clj_number,
    COALESCE(j.status::TEXT, 'lead') as entity_status,
    CASE 
      WHEN j.clj_formatted_number LIKE normalized_term || '%' THEN 1
      WHEN LOWER(COALESCE(j.name, '')) LIKE normalized_term || '%' THEN 2
      ELSE 3
    END as match_score
  FROM jobs j
  LEFT JOIN pipeline_entries pe ON pe.id = j.pipeline_entry_id
  LEFT JOIN contacts jc ON jc.id = j.contact_id
  WHERE j.tenant_id = p_tenant_id
    AND j.is_deleted = false
    AND (
      p_location_id IS NULL 
      OR COALESCE(pe.location_id, jc.location_id) = p_location_id
      OR (COALESCE(pe.location_id, jc.location_id) IS NULL AND j.created_by = auth.uid())
    )
    AND (
      j.clj_formatted_number LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(j.name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(jc.first_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(jc.last_name, '')) LIKE '%' || normalized_term || '%'
      OR LOWER(COALESCE(jc.address_street, '')) LIKE '%' || normalized_term || '%'
    )

  ORDER BY match_score, entity_name
  LIMIT 20;
END;
$$;
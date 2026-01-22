-- Fix search_contacts_and_jobs RPC function - correct column names
-- c.address → c.address_street
-- c.status → c.lead_status

CREATE OR REPLACE FUNCTION search_contacts_and_jobs(
  p_tenant_id uuid,
  p_search_term text,
  p_location_id uuid DEFAULT NULL
)
RETURNS TABLE(
  entity_type text,
  entity_id uuid,
  entity_name text,
  entity_subtext text,
  clj_number text,
  entity_status text,
  match_score integer
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_search_pattern text;
BEGIN
  v_search_pattern := '%' || lower(p_search_term) || '%';
  
  RETURN QUERY
  -- CONTACTS
  SELECT 
    'contact'::text AS entity_type,
    c.id AS entity_id,
    COALESCE(c.first_name || ' ' || c.last_name, c.first_name, c.last_name, 'Unnamed Contact')::text AS entity_name,
    COALESCE(c.address_street, c.email, c.phone, '')::text AS entity_subtext,
    ''::text AS clj_number,
    COALESCE(c.lead_status, 'active')::text AS entity_status,
    CASE 
      WHEN lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 100
      WHEN lower(COALESCE(c.first_name, '')) LIKE lower(p_search_term) || '%' THEN 90
      WHEN lower(COALESCE(c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 85
      ELSE 50
    END AS match_score
  FROM contacts c
  WHERE c.tenant_id = p_tenant_id
    AND c.is_deleted = false
    AND (
      lower(COALESCE(c.first_name, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.last_name, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.email, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.phone, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.address_street, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.address_city, '')) LIKE v_search_pattern
    )
  
  UNION ALL
  
  -- LEADS (pipeline_entries)
  SELECT 
    'lead'::text AS entity_type,
    pe.id AS entity_id,
    COALESCE(c.first_name || ' ' || c.last_name, c.first_name, c.last_name, pe.clj_formatted_number, 'Unnamed Lead')::text AS entity_name,
    COALESCE(c.address_street, c.email, '')::text AS entity_subtext,
    COALESCE(pe.clj_formatted_number, '')::text AS clj_number,
    COALESCE(pe.status::text, 'lead')::text AS entity_status,
    CASE 
      WHEN lower(COALESCE(pe.clj_formatted_number, '')) LIKE lower(p_search_term) || '%' THEN 100
      WHEN lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 95
      ELSE 50
    END AS match_score
  FROM pipeline_entries pe
  LEFT JOIN contacts c ON c.id = pe.contact_id
  WHERE pe.tenant_id = p_tenant_id
    AND pe.is_deleted = false
    AND (
      p_location_id IS NULL 
      OR pe.location_id = p_location_id 
      OR (pe.location_id IS NULL AND pe.created_by = auth.uid())
    )
    AND (
      lower(COALESCE(pe.clj_formatted_number, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.first_name, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.last_name, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.address_street, '')) LIKE v_search_pattern
    )
  
  UNION ALL
  
  -- PROJECTS (replaces JOBS)
  SELECT 
    'job'::text AS entity_type,
    p.id AS entity_id,
    COALESCE(p.name, p.clj_formatted_number, 'Unnamed Project')::text AS entity_name,
    COALESCE(c.first_name || ' ' || c.last_name, c.address_street, '')::text AS entity_subtext,
    COALESCE(p.clj_formatted_number, '')::text AS clj_number,
    COALESCE(p.status, 'active')::text AS entity_status,
    CASE 
      WHEN lower(COALESCE(p.clj_formatted_number, '')) LIKE lower(p_search_term) || '%' THEN 100
      WHEN lower(COALESCE(p.name, '')) LIKE lower(p_search_term) || '%' THEN 95
      ELSE 50
    END AS match_score
  FROM projects p
  LEFT JOIN pipeline_entries pe ON pe.id = p.pipeline_entry_id
  LEFT JOIN contacts c ON c.id = pe.contact_id
  WHERE p.tenant_id = p_tenant_id
    AND (
      p_location_id IS NULL 
      OR p.location_id = p_location_id 
      OR (p.location_id IS NULL AND p.created_by = auth.uid())
    )
    AND (
      lower(COALESCE(p.clj_formatted_number, '')) LIKE v_search_pattern
      OR lower(COALESCE(p.name, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.first_name, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.last_name, '')) LIKE v_search_pattern
      OR lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE v_search_pattern
    )
  
  ORDER BY match_score DESC, entity_name
  LIMIT 50;
END;
$$;
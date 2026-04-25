CREATE OR REPLACE FUNCTION public.search_contacts_and_jobs(p_tenant_id uuid, p_search_term text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(entity_type text, entity_id uuid, entity_name text, entity_subtext text, clj_number text, entity_status text, match_score integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_search_pattern text;
  v_digits text;
  v_digits_pattern text;
  v_has_digits boolean;
BEGIN
  v_search_pattern := '%' || lower(p_search_term) || '%';
  v_digits := regexp_replace(coalesce(p_search_term, ''), '\D', '', 'g');
  v_has_digits := length(v_digits) >= 3;
  v_digits_pattern := '%' || v_digits || '%';

  RETURN QUERY
  SELECT * FROM (
    -- CONTACTS
    SELECT
      'contact'::text AS entity_type,
      c.id AS entity_id,
      COALESCE(c.first_name || ' ' || c.last_name, c.first_name, c.last_name, 'Unnamed Contact')::text AS entity_name,
      COALESCE(c.address_street, c.email, c.phone, '')::text AS entity_subtext,
      ''::text AS clj_number,
      COALESCE(c.lead_status, 'active')::text AS entity_status,
      CASE
        WHEN lower(COALESCE(c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 100
        WHEN lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 98
        WHEN lower(COALESCE(c.first_name, '')) LIKE lower(p_search_term) || '%' THEN 90
        WHEN v_has_digits AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE v_digits_pattern THEN 95
        WHEN lower(COALESCE(c.address_street, '')) LIKE v_search_pattern THEN 80
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
        OR lower(COALESCE(c.address_street, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_city, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_state, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_zip, '')) LIKE v_search_pattern
        OR (v_has_digits AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE v_digits_pattern)
        OR (v_has_digits AND regexp_replace(COALESCE(c.secondary_phone, ''), '\D', '', 'g') LIKE v_digits_pattern)
      )

    UNION ALL

    -- LEADS
    SELECT
      'lead'::text,
      pe.id,
      COALESCE(pe.lead_name, c.first_name || ' ' || c.last_name, c.first_name, c.last_name, pe.clj_formatted_number, 'Unnamed Lead')::text,
      COALESCE(c.address_street, c.email, '')::text,
      COALESCE(pe.clj_formatted_number, '')::text,
      COALESCE(pe.status::text, 'lead')::text,
      CASE
        WHEN lower(COALESCE(pe.clj_formatted_number, '')) LIKE lower(p_search_term) || '%' THEN 100
        WHEN lower(COALESCE(c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 98
        WHEN lower(COALESCE(pe.lead_name, '')) LIKE lower(p_search_term) || '%' THEN 97
        WHEN lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 95
        WHEN v_has_digits AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE v_digits_pattern THEN 92
        WHEN lower(COALESCE(c.address_street, '')) LIKE v_search_pattern THEN 80
        ELSE 50
      END
    FROM pipeline_entries pe
    LEFT JOIN contacts c ON c.id = pe.contact_id
    WHERE pe.tenant_id = p_tenant_id
      AND pe.is_deleted = false
      AND pe.status != 'project'
      AND (
        lower(COALESCE(pe.clj_formatted_number, '')) LIKE v_search_pattern
        OR lower(COALESCE(pe.lead_name, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.first_name, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.last_name, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.email, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_street, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_city, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_state, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_zip, '')) LIKE v_search_pattern
        OR (v_has_digits AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE v_digits_pattern)
        OR (v_has_digits AND regexp_replace(COALESCE(c.secondary_phone, ''), '\D', '', 'g') LIKE v_digits_pattern)
      )

    UNION ALL

    -- JOBS
    SELECT
      'job'::text,
      pe.id,
      COALESCE(pe.lead_name, c.first_name || ' ' || c.last_name, c.first_name, c.last_name, pe.clj_formatted_number, 'Unnamed Job')::text,
      COALESCE(c.address_street, c.email, '')::text,
      COALESCE(pe.clj_formatted_number, '')::text,
      COALESCE(pe.status::text, 'project')::text,
      CASE
        WHEN lower(COALESCE(pe.clj_formatted_number, '')) LIKE lower(p_search_term) || '%' THEN 100
        WHEN lower(COALESCE(c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 98
        WHEN lower(COALESCE(pe.lead_name, '')) LIKE lower(p_search_term) || '%' THEN 97
        WHEN lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 95
        WHEN v_has_digits AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE v_digits_pattern THEN 92
        WHEN lower(COALESCE(c.address_street, '')) LIKE v_search_pattern THEN 80
        ELSE 50
      END
    FROM pipeline_entries pe
    LEFT JOIN contacts c ON c.id = pe.contact_id
    WHERE pe.tenant_id = p_tenant_id
      AND pe.is_deleted = false
      AND pe.status = 'project'
      AND (
        lower(COALESCE(pe.clj_formatted_number, '')) LIKE v_search_pattern
        OR lower(COALESCE(pe.lead_name, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.first_name, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.last_name, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.email, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_street, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_city, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_state, '')) LIKE v_search_pattern
        OR lower(COALESCE(c.address_zip, '')) LIKE v_search_pattern
        OR (v_has_digits AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE v_digits_pattern)
        OR (v_has_digits AND regexp_replace(COALESCE(c.secondary_phone, ''), '\D', '', 'g') LIKE v_digits_pattern)
      )
  ) results
  ORDER BY match_score DESC, entity_name
  LIMIT 50;
END;
$function$;
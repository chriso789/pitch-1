CREATE OR REPLACE FUNCTION public.search_contacts_and_jobs(p_tenant_id uuid, p_search_term text, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(entity_type text, entity_id uuid, entity_name text, entity_subtext text, clj_number text, entity_status text, match_score integer, project_type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_search_pattern text; v_digits text; v_digits_pattern text; v_has_digits boolean;
BEGIN
  v_search_pattern := '%' || lower(p_search_term) || '%';
  v_digits := regexp_replace(coalesce(p_search_term, ''), '\D', '', 'g');
  v_has_digits := length(v_digits) >= 3;
  v_digits_pattern := '%' || v_digits || '%';

  RETURN QUERY
  SELECT * FROM (
    SELECT 'contact'::text, c.id,
      COALESCE(c.first_name || ' ' || c.last_name, c.first_name, c.last_name, 'Unnamed Contact')::text,
      COALESCE(c.address_street, c.email, c.phone, '')::text, ''::text,
      COALESCE(c.lead_status, 'active')::text,
      CASE
        WHEN lower(COALESCE(c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 100
        WHEN lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 98
        WHEN lower(COALESCE(c.first_name, '')) LIKE lower(p_search_term) || '%' THEN 90
        WHEN v_has_digits AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE v_digits_pattern THEN 95
        WHEN lower(COALESCE(c.address_street, '')) LIKE v_search_pattern THEN 80
        ELSE 50 END, ''::text
    FROM contacts c
    WHERE c.tenant_id = p_tenant_id
      AND c.is_deleted = false AND c.deleted_at IS NULL
      AND (p_location_id IS NULL OR c.location_id = p_location_id)
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

    SELECT 'lead'::text, pe.id,
      COALESCE(pe.lead_name, c.first_name || ' ' || c.last_name, c.first_name, c.last_name, pe.clj_formatted_number, 'Unnamed Lead')::text,
      COALESCE(c.address_street, c.email, '')::text,
      COALESCE(
        CASE
          WHEN pe.clj_formatted_number ~ '^[A-Za-z]+-'
               AND COALESCE(loc.location_code, cloc.location_code) IS NOT NULL
            THEN regexp_replace(pe.clj_formatted_number, '^[A-Za-z]+-',
                                COALESCE(loc.location_code, cloc.location_code) || '-')
          ELSE pe.clj_formatted_number
        END,
        ''
      )::text,
      COALESCE(pe.status::text, 'lead')::text,
      CASE
        WHEN lower(COALESCE(pe.clj_formatted_number, '')) LIKE lower(p_search_term) || '%' THEN 100
        WHEN lower(COALESCE(c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 98
        WHEN lower(COALESCE(pe.lead_name, '')) LIKE lower(p_search_term) || '%' THEN 97
        WHEN lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 95
        WHEN v_has_digits AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE v_digits_pattern THEN 92
        WHEN lower(COALESCE(c.address_street, '')) LIKE v_search_pattern THEN 80
        ELSE 50 END,
      COALESCE(NULLIF(pe.metadata->>'project_type', ''), pe.roof_type::text, '')::text
    FROM pipeline_entries pe
    LEFT JOIN contacts c ON c.id = pe.contact_id
    LEFT JOIN locations loc ON loc.id = pe.location_id
    LEFT JOIN locations cloc ON cloc.id = c.location_id
    WHERE pe.tenant_id = p_tenant_id
      AND pe.is_deleted = false AND pe.deleted_at IS NULL
      AND (c.id IS NULL OR (c.is_deleted = false AND c.deleted_at IS NULL))
      AND pe.status::text IN ('lead','estimate_sent','contingency_signed','claim_filed','claim_approved','ready_for_approval','legal_review')
      AND (p_location_id IS NULL OR pe.location_id = p_location_id OR c.location_id = p_location_id)
      AND (
        lower(COALESCE(pe.clj_formatted_number, '')) LIKE v_search_pattern
        -- collapsed badge form: EC-L04 / L04
        OR regexp_replace(lower(COALESCE(pe.clj_formatted_number, '')), '^([a-z]+)-(\d+)-(\d+)-(\d+)$', '\1-l\3') LIKE v_search_pattern
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

    SELECT 'job'::text, pe.id,
      COALESCE(pe.lead_name, c.first_name || ' ' || c.last_name, c.first_name, c.last_name, pr.name, pe.clj_formatted_number, 'Unnamed Job')::text,
      COALESCE(c.address_street, c.email, '')::text,
      COALESCE(
        CASE
          WHEN COALESCE(pr.clj_formatted_number, pe.clj_formatted_number) ~ '^[A-Za-z]+-'
               AND COALESCE(loc.location_code, cloc.location_code) IS NOT NULL
            THEN regexp_replace(COALESCE(pr.clj_formatted_number, pe.clj_formatted_number), '^[A-Za-z]+-',
                                COALESCE(loc.location_code, cloc.location_code) || '-')
          ELSE COALESCE(pr.clj_formatted_number, pe.clj_formatted_number)
        END,
        ''
      )::text,
      COALESCE(pe.status::text, 'project')::text,
      CASE
        WHEN lower(COALESCE(pr.project_number, '')) LIKE lower(p_search_term) || '%' THEN 100
        WHEN lower(COALESCE(pr.clj_formatted_number, '')) LIKE lower(p_search_term) || '%' THEN 100
        WHEN lower(COALESCE(pe.clj_formatted_number, '')) LIKE lower(p_search_term) || '%' THEN 100
        WHEN lower(COALESCE(c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 98
        WHEN lower(COALESCE(pe.lead_name, '')) LIKE lower(p_search_term) || '%' THEN 97
        WHEN lower(COALESCE(c.first_name || ' ' || c.last_name, '')) LIKE lower(p_search_term) || '%' THEN 95
        WHEN v_has_digits AND regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g') LIKE v_digits_pattern THEN 92
        WHEN lower(COALESCE(c.address_street, '')) LIKE v_search_pattern THEN 80
        ELSE 50 END,
      COALESCE(NULLIF(pe.metadata->>'project_type', ''), pe.roof_type::text, '')::text
    FROM pipeline_entries pe
    LEFT JOIN contacts c ON c.id = pe.contact_id
    LEFT JOIN locations loc ON loc.id = pe.location_id
    LEFT JOIN locations cloc ON cloc.id = c.location_id
    LEFT JOIN LATERAL (
      SELECT p2.name, p2.project_number, p2.clj_formatted_number
      FROM projects p2
      WHERE p2.pipeline_entry_id = pe.id AND p2.tenant_id = pe.tenant_id
      ORDER BY p2.created_at DESC
      LIMIT 1
    ) pr ON true
    WHERE pe.tenant_id = p_tenant_id
      AND pe.is_deleted = false AND pe.deleted_at IS NULL
      AND (c.id IS NULL OR (c.is_deleted = false AND c.deleted_at IS NULL))
      AND pe.status::text NOT IN ('lead','estimate_sent','contingency_signed','claim_filed','claim_approved','ready_for_approval','legal_review','lost')
      AND (p_location_id IS NULL OR pe.location_id = p_location_id OR c.location_id = p_location_id)
      AND (
        lower(COALESCE(pe.clj_formatted_number, '')) LIKE v_search_pattern
        OR lower(COALESCE(pr.clj_formatted_number, '')) LIKE v_search_pattern
        OR lower(COALESCE(pr.project_number, '')) LIKE v_search_pattern
        OR lower(COALESCE(pr.name, '')) LIKE v_search_pattern
        -- collapsed badge form: EC-J06 / J06 (from project or pipeline CLJ)
        OR regexp_replace(lower(COALESCE(pr.clj_formatted_number, '')), '^([a-z]+)-(\d+)-(\d+)-(\d+)$', '\1-j\4') LIKE v_search_pattern
        OR regexp_replace(lower(COALESCE(pe.clj_formatted_number, '')), '^([a-z]+)-(\d+)-(\d+)-(\d+)$', '\1-j\4') LIKE v_search_pattern
        -- bare job number digits: "15" matches JOB-0015
        OR (length(v_digits) > 0 AND regexp_replace(COALESCE(pr.project_number, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
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
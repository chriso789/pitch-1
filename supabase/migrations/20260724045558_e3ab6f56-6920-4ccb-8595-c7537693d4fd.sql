
DROP FUNCTION IF EXISTS public.reresolve_projects_for_mapping(uuid);

-- (identical to the previous migration; helpers to mark cache stale, validate
-- a mapping server-side, re-resolve affected projects, and list projects
-- currently using a mapping)

CREATE OR REPLACE FUNCTION public.mark_qbo_cache_stale(
  p_connection_id uuid, p_entity_kind text, p_seen_ids text[]
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF p_entity_kind = 'item' THEN
    UPDATE public.qbo_item_cache SET active=false, updated_at=now()
    WHERE qbo_connection_id=p_connection_id AND active=true AND NOT (qbo_id = ANY(p_seen_ids));
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_entity_kind = 'account' THEN
    UPDATE public.qbo_account_cache SET active=false, updated_at=now()
    WHERE qbo_connection_id=p_connection_id AND active=true AND NOT (qbo_id = ANY(p_seen_ids));
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_entity_kind = 'class' THEN
    UPDATE public.qbo_class_cache SET active=false, updated_at=now()
    WHERE qbo_connection_id=p_connection_id AND active=true AND NOT (qbo_id = ANY(p_seen_ids));
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_entity_kind = 'department' THEN
    UPDATE public.qbo_department_cache SET active=false, updated_at=now()
    WHERE qbo_connection_id=p_connection_id AND active=true AND NOT (qbo_id = ANY(p_seen_ids));
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_entity_kind = 'tax_code' THEN
    UPDATE public.qbo_tax_code_cache SET active=false, updated_at=now()
    WHERE qbo_connection_id=p_connection_id AND active=true AND NOT (qbo_id = ANY(p_seen_ids));
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF p_entity_kind = 'terms' THEN
    UPDATE public.qbo_terms_cache SET active=false, updated_at=now()
    WHERE qbo_connection_id=p_connection_id AND active=true AND NOT (qbo_id = ANY(p_seen_ids));
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSE RAISE EXCEPTION 'unknown entity kind: %', p_entity_kind;
  END IF;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.mark_qbo_cache_stale(uuid, text, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_qbo_cache_stale(uuid, text, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_scope_mapping(p_mapping_id uuid)
RETURNS TABLE(mapping_id uuid, validation_status text, validation_error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m record; item_row record;
  new_status text := 'valid'; new_error text := null;
  item_name text; item_type text; income_id text; income_name text;
  class_row record; dept_name text; tax_name text; terms_name text;
BEGIN
  SELECT * INTO m FROM public.project_scope_accounting_mappings WHERE id = p_mapping_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'mapping_not_found'; END IF;

  SELECT qbo_id, name, fully_qualified_name, item_type, active, income_account_id, income_account_name
    INTO item_row
  FROM public.qbo_item_cache
  WHERE qbo_connection_id = m.qbo_connection_id AND qbo_id = m.qbo_item_id
  LIMIT 1;

  IF NOT FOUND THEN
    new_status := 'invalid_item_missing';
    new_error := 'Mapped QuickBooks Item was not found in this connection''s catalog.';
  ELSIF item_row.active = false THEN
    new_status := 'inactive_item';
    new_error := 'Mapped QuickBooks Item is inactive in QuickBooks.';
  ELSIF item_row.item_type IS NOT NULL
        AND item_row.item_type NOT IN ('Service','Inventory','NonInventory','Group','Category') THEN
    new_status := 'invalid_item_type';
    new_error := format('Item type "%s" is not supported on sales invoice lines.', item_row.item_type);
  ELSE
    item_name := coalesce(item_row.fully_qualified_name, item_row.name);
    item_type := item_row.item_type;
    income_id := item_row.income_account_id;
    income_name := item_row.income_account_name;
  END IF;

  IF new_status = 'valid' AND m.qbo_class_id IS NOT NULL THEN
    SELECT name, active INTO class_row
    FROM public.qbo_class_cache
    WHERE qbo_connection_id = m.qbo_connection_id AND qbo_id = m.qbo_class_id LIMIT 1;
    IF NOT FOUND THEN
      new_status := 'invalid_class_missing'; new_error := 'Selected Class not found for this connection.';
    ELSIF class_row.active = false THEN
      new_status := 'invalid_class_inactive'; new_error := 'Selected Class is inactive.';
    END IF;
  END IF;

  IF new_status = 'valid' AND m.qbo_department_id IS NOT NULL THEN
    SELECT name INTO dept_name FROM public.qbo_department_cache
    WHERE qbo_connection_id = m.qbo_connection_id AND qbo_id = m.qbo_department_id AND active = true;
    IF dept_name IS NULL THEN
      new_status := 'invalid_department'; new_error := 'Selected Department/Location is missing or inactive.';
    END IF;
  END IF;

  IF new_status = 'valid' AND m.qbo_tax_code_id IS NOT NULL THEN
    SELECT name INTO tax_name FROM public.qbo_tax_code_cache
    WHERE qbo_connection_id = m.qbo_connection_id AND qbo_id = m.qbo_tax_code_id AND active = true;
    IF tax_name IS NULL THEN
      new_status := 'invalid_tax_code'; new_error := 'Selected Tax Code is missing or inactive.';
    END IF;
  END IF;

  IF new_status = 'valid' AND m.qbo_terms_id IS NOT NULL THEN
    SELECT name INTO terms_name FROM public.qbo_terms_cache
    WHERE qbo_connection_id = m.qbo_connection_id AND qbo_id = m.qbo_terms_id AND active = true;
    IF terms_name IS NULL THEN
      new_status := 'invalid_terms'; new_error := 'Selected Terms are missing or inactive.';
    END IF;
  END IF;

  UPDATE public.project_scope_accounting_mappings
     SET validation_status = new_status,
         validation_error = new_error,
         last_validated_at = now(),
         qbo_item_name_snapshot = coalesce(item_name, qbo_item_name_snapshot),
         qbo_item_type_snapshot = coalesce(item_type, qbo_item_type_snapshot),
         qbo_income_account_id_snapshot = coalesce(income_id, qbo_income_account_id_snapshot),
         qbo_income_account_name_snapshot = coalesce(income_name, qbo_income_account_name_snapshot),
         qbo_class_name_snapshot = coalesce(class_row.name, qbo_class_name_snapshot),
         qbo_department_name_snapshot = coalesce(dept_name, qbo_department_name_snapshot),
         qbo_tax_code_name_snapshot = coalesce(tax_name, qbo_tax_code_name_snapshot),
         qbo_terms_name_snapshot = coalesce(terms_name, qbo_terms_name_snapshot),
         updated_at = now()
   WHERE id = p_mapping_id;

  RETURN QUERY SELECT p_mapping_id, new_status, new_error;
END; $$;

REVOKE ALL ON FUNCTION public.validate_scope_mapping(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.validate_scope_mapping(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reresolve_projects_for_mapping(p_mapping_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m record; p record; cnt integer := 0;
BEGIN
  SELECT * INTO m FROM public.project_scope_accounting_mappings WHERE id = p_mapping_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  FOR p IN
    SELECT DISTINCT ps.project_id
    FROM public.project_scopes ps
    JOIN public.projects pr ON pr.id = ps.project_id
    WHERE pr.tenant_id = m.tenant_id
      AND ps.status = 'active'
      AND ps.trade_id = m.trade_id
      AND ps.project_type_id = m.project_type_id
      AND (m.job_type_id IS NULL OR ps.job_type_id = m.job_type_id)
  LOOP
    PERFORM public.resolve_project_accounting(p.project_id);
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END; $$;

REVOKE ALL ON FUNCTION public.reresolve_projects_for_mapping(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reresolve_projects_for_mapping(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.list_projects_using_mapping(uuid);
CREATE FUNCTION public.list_projects_using_mapping(p_mapping_id uuid)
RETURNS TABLE(
  project_id uuid, project_scope_id uuid, trade_name text,
  contract_amount_cents bigint, resolution_status text, last_validated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT r.project_id, r.project_scope_id,
         ps.trade_name_snapshot, ps.current_contract_amount_cents,
         r.resolution_status, r.last_validated_at
  FROM public.project_scope_accounting_resolutions r
  JOIN public.project_scopes ps ON ps.id = r.project_scope_id
  WHERE r.mapping_id = p_mapping_id AND ps.status = 'active';
END; $$;

REVOKE ALL ON FUNCTION public.list_projects_using_mapping(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.list_projects_using_mapping(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.api_bulk_import_materials(p_materials jsonb, p_tenant_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer := 0; v_item jsonb; v_category_id uuid;
BEGIN
  IF p_tenant_id IS NULL OR NOT public.user_can_access_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Not allowed to import materials for this company' USING ERRCODE = '42501';
  END IF;
  IF jsonb_array_length(p_materials) > 5000 THEN RAISE EXCEPTION 'At most 5000 materials per import'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_materials) LOOP
    SELECT id INTO v_category_id FROM public.material_categories WHERE code = UPPER(v_item->>'category') OR name ILIKE v_item->>'category' LIMIT 1;
    PERFORM public.api_upsert_material(
      p_code := v_item->>'code', p_name := v_item->>'name', p_tenant_id := p_tenant_id, p_category_id := v_category_id,
      p_uom := COALESCE(v_item->>'uom','EA'), p_base_cost := (v_item->>'base_cost')::numeric,
      p_default_markup_pct := COALESCE((v_item->>'markup_pct')::numeric, 0.35), p_coverage_per_unit := (v_item->>'coverage')::numeric,
      p_description := v_item->>'description', p_supplier_sku := v_item->>'sku',
      p_tags := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item->'tags','[]'::jsonb))));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
REVOKE EXECUTE ON FUNCTION public.api_bulk_import_materials(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_bulk_import_materials(jsonb, uuid) TO authenticated, service_role;
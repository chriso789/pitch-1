CREATE OR REPLACE FUNCTION public.api_bulk_sync_template_items_to_catalog(p_template_id uuid, p_tenant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_item RECORD;
  v_material_id UUID;
  v_code TEXT;
BEGIN
  FOR v_item IN
    SELECT *
    FROM public.estimate_calc_template_items
    WHERE calc_template_id = p_template_id
      AND item_type = 'material'
      AND material_id IS NULL
  LOOP
    v_code := COALESCE(
      NULLIF(v_item.sku_pattern, ''),
      LOWER(REGEXP_REPLACE(v_item.item_name, '[^a-zA-Z0-9]+', '-', 'g'))
    );

    -- 1. Look up existing material by case-insensitive name (covers materials_tenant_name_unique)
    SELECT id INTO v_material_id
    FROM public.materials
    WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND lower(name) = lower(v_item.item_name)
    LIMIT 1;

    -- 2. Fallback: look up by code
    IF v_material_id IS NULL THEN
      SELECT id INTO v_material_id
      FROM public.materials
      WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        AND code = v_code
      LIMIT 1;
    END IF;

    -- 3. Insert if not found
    IF v_material_id IS NULL THEN
      BEGIN
        SELECT public.api_upsert_material(
          p_code := v_code,
          p_name := v_item.item_name,
          p_tenant_id := p_tenant_id,
          p_category_id := NULL,
          p_uom := COALESCE(NULLIF(v_item.unit, ''), 'EA'),
          p_base_cost := v_item.unit_cost,
          p_description := v_item.description
        ) INTO v_material_id;
      EXCEPTION WHEN unique_violation THEN
        -- Race: another row with same name was created. Look it up again.
        SELECT id INTO v_material_id
        FROM public.materials
        WHERE COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = COALESCE(p_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
          AND lower(name) = lower(v_item.item_name)
        LIMIT 1;
      END;
    END IF;

    -- 4. Link the template item to the resolved material
    IF v_material_id IS NOT NULL THEN
      UPDATE public.estimate_calc_template_items
      SET material_id = v_material_id
      WHERE id = v_item.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;
-- Fix bulk catalog sync ON CONFLICT mismatch by delegating to api_upsert_material

CREATE OR REPLACE FUNCTION public.api_bulk_sync_template_items_to_catalog(
  p_template_id UUID,
  p_tenant_id UUID
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    -- Use existing upsert function so ON CONFLICT matches the unique index
    SELECT public.api_upsert_material(
      p_code := v_code,
      p_name := v_item.item_name,
      p_tenant_id := p_tenant_id,
      p_category_id := NULL,
      p_uom := COALESCE(NULLIF(v_item.unit, ''), 'EA'),
      p_base_cost := v_item.unit_cost,
      p_description := v_item.description
    ) INTO v_material_id;

    UPDATE public.estimate_calc_template_items
    SET material_id = v_material_id
    WHERE id = v_item.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
-- Fix: Remove 'category' column reference from bulk catalog sync function
-- The materials table uses category_id (UUID), not category (TEXT)

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
  -- Loop through all uncataloged material items in the template
  FOR v_item IN 
    SELECT * FROM estimate_calc_template_items 
    WHERE calc_template_id = p_template_id 
      AND item_type = 'material'
      AND material_id IS NULL
  LOOP
    -- Generate a unique code from SKU pattern or item name
    v_code := COALESCE(
      v_item.sku_pattern, 
      LOWER(REGEXP_REPLACE(v_item.item_name, '[^a-zA-Z0-9]+', '-', 'g'))
    );
    
    -- Create or update material in catalog (without category - let it be NULL)
    INSERT INTO materials (code, name, uom, base_cost, tenant_id, description)
    VALUES (
      v_code,
      v_item.item_name,
      v_item.unit,
      v_item.unit_cost,
      p_tenant_id,
      v_item.description
    )
    ON CONFLICT (code, tenant_id) DO UPDATE SET
      base_cost = EXCLUDED.base_cost,
      updated_at = NOW()
    RETURNING id INTO v_material_id;
    
    -- Link template item to the material
    UPDATE estimate_calc_template_items 
    SET material_id = v_material_id
    WHERE id = v_item.id;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;
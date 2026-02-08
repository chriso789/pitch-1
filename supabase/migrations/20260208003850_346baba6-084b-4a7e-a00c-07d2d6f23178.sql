-- Bulk sync all uncataloged template items to the materials catalog
CREATE OR REPLACE FUNCTION api_bulk_sync_template_items_to_catalog(
  p_template_id UUID,
  p_tenant_id UUID
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_item RECORD;
  v_material_id UUID;
  v_code TEXT;
BEGIN
  FOR v_item IN 
    SELECT * FROM estimate_calc_template_items 
    WHERE calc_template_id = p_template_id 
      AND item_type = 'material'
      AND material_id IS NULL
  LOOP
    -- Generate a unique code from SKU pattern or item name
    v_code := COALESCE(
      NULLIF(v_item.sku_pattern, ''), 
      LOWER(REGEXP_REPLACE(v_item.item_name, '[^a-zA-Z0-9]+', '-', 'g'))
    );
    
    -- Check if material already exists with this code for this tenant
    SELECT id INTO v_material_id
    FROM materials
    WHERE code = v_code AND tenant_id = p_tenant_id;
    
    IF v_material_id IS NULL THEN
      -- Create new material in catalog
      INSERT INTO materials (code, name, uom, base_cost, tenant_id, description, category)
      VALUES (
        v_code,
        v_item.item_name,
        v_item.unit,
        v_item.unit_cost,
        p_tenant_id,
        v_item.description,
        'GENERAL'
      )
      RETURNING id INTO v_material_id;
    ELSE
      -- Update existing material with latest cost
      UPDATE materials 
      SET base_cost = v_item.unit_cost,
          updated_at = NOW()
      WHERE id = v_material_id;
    END IF;
    
    -- Link template item to material
    UPDATE estimate_calc_template_items 
    SET material_id = v_material_id
    WHERE id = v_item.id;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
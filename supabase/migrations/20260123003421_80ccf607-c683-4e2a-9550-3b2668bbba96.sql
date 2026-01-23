-- Drop all existing versions of api_upsert_material to resolve overload conflicts
DROP FUNCTION IF EXISTS public.api_upsert_material(TEXT, TEXT, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, TEXT, TEXT, TEXT[], JSONB);
DROP FUNCTION IF EXISTS public.api_upsert_material(TEXT, TEXT, UUID, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, TEXT, TEXT, TEXT[], JSONB);

-- Recreate the single tenant-aware function with correct parameter order
CREATE OR REPLACE FUNCTION public.api_upsert_material(
  p_code TEXT,
  p_name TEXT,
  p_tenant_id UUID DEFAULT NULL,
  p_category_id UUID DEFAULT NULL,
  p_uom TEXT DEFAULT 'EA',
  p_base_cost DECIMAL DEFAULT NULL,
  p_default_markup_pct DECIMAL DEFAULT 0.35,
  p_coverage_per_unit DECIMAL DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_supplier_sku TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_attributes JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_material_id UUID;
BEGIN
  INSERT INTO materials (
    code, name, tenant_id, category_id, uom, base_cost, 
    default_markup_pct, coverage_per_unit, description, 
    supplier_sku, tags, attributes
  )
  VALUES (
    p_code, p_name, p_tenant_id, p_category_id, p_uom, p_base_cost,
    p_default_markup_pct, p_coverage_per_unit, p_description,
    p_supplier_sku, p_tags, p_attributes
  )
  ON CONFLICT (code, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'))
  DO UPDATE SET
    name = EXCLUDED.name,
    category_id = COALESCE(EXCLUDED.category_id, materials.category_id),
    uom = EXCLUDED.uom,
    base_cost = COALESCE(EXCLUDED.base_cost, materials.base_cost),
    default_markup_pct = EXCLUDED.default_markup_pct,
    coverage_per_unit = COALESCE(EXCLUDED.coverage_per_unit, materials.coverage_per_unit),
    description = COALESCE(EXCLUDED.description, materials.description),
    supplier_sku = COALESCE(EXCLUDED.supplier_sku, materials.supplier_sku),
    tags = COALESCE(EXCLUDED.tags, materials.tags),
    attributes = materials.attributes || EXCLUDED.attributes,
    updated_at = NOW()
  RETURNING id INTO v_material_id;
  
  RETURN v_material_id;
END;
$$;
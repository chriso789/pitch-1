-- ========================================
-- Update api_get_materials to include tenant materials
-- Must drop first due to return type change
-- ========================================

DROP FUNCTION IF EXISTS public.api_get_materials();

CREATE OR REPLACE FUNCTION public.api_get_materials()
RETURNS TABLE (
  id UUID,
  code TEXT,
  name TEXT,
  description TEXT,
  category_id UUID,
  uom TEXT,
  coverage_per_unit DECIMAL,
  base_cost DECIMAL,
  default_markup_pct DECIMAL,
  is_taxable BOOLEAN,
  tags TEXT[],
  attributes JSONB,
  supplier_sku TEXT,
  active BOOLEAN,
  tenant_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  -- Get current user's tenant
  SELECT p.tenant_id INTO v_tenant_id
  FROM profiles p
  WHERE p.id = auth.uid();

  RETURN QUERY
  SELECT 
    m.id,
    m.code,
    m.name,
    m.description,
    m.category_id,
    m.uom,
    m.coverage_per_unit,
    m.base_cost,
    m.default_markup_pct,
    m.is_taxable,
    m.tags,
    m.attributes,
    m.supplier_sku,
    m.active,
    m.tenant_id
  FROM materials m
  WHERE m.tenant_id IS NULL OR m.tenant_id = v_tenant_id
  ORDER BY m.name;
END;
$$;
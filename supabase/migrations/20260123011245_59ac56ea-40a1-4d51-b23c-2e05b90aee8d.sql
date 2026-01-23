-- Update api_get_materials to use active_tenant_id for proper multi-tenant support
CREATE OR REPLACE FUNCTION public.api_get_materials()
RETURNS TABLE(
  id UUID,
  code TEXT,
  name TEXT,
  description TEXT,
  category_id UUID,
  uom TEXT,
  coverage_per_unit NUMERIC,
  base_cost NUMERIC,
  default_markup_pct NUMERIC,
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
  v_active_tenant_id UUID;
BEGIN
  -- Get current user's tenant and active tenant
  SELECT p.tenant_id, p.active_tenant_id 
  INTO v_tenant_id, v_active_tenant_id
  FROM profiles p
  WHERE p.id = auth.uid();

  -- Use active_tenant_id if set, otherwise fall back to tenant_id
  v_tenant_id := COALESCE(v_active_tenant_id, v_tenant_id);

  RETURN QUERY
  SELECT 
    m.id, m.code, m.name, m.description, m.category_id,
    m.uom, m.coverage_per_unit, m.base_cost, m.default_markup_pct,
    m.is_taxable, m.tags, m.attributes, m.supplier_sku, m.active, m.tenant_id
  FROM materials m
  WHERE m.tenant_id IS NULL OR m.tenant_id = v_tenant_id
  ORDER BY m.name;
END;
$$;
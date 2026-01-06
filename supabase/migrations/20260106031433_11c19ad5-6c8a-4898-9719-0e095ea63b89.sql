-- Drop and recreate get_user_accessible_tenants to include is_active field
DROP FUNCTION IF EXISTS public.get_user_accessible_tenants();

CREATE FUNCTION public.get_user_accessible_tenants()
RETURNS TABLE(
  tenant_id uuid,
  tenant_name text,
  tenant_subdomain text,
  access_level text,
  is_primary boolean,
  is_active boolean,
  location_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id as tenant_id,
    t.name as tenant_name,
    t.subdomain as tenant_subdomain,
    uca.access_level,
    (t.id = p.tenant_id) as is_primary,
    COALESCE(t.is_active, true) as is_active,
    (SELECT COUNT(*) FROM locations WHERE locations.tenant_id = t.id AND locations.is_active = true) as location_count
  FROM user_company_access uca
  JOIN tenants t ON uca.tenant_id = t.id
  JOIN profiles p ON p.id = auth.uid()
  WHERE uca.user_id = auth.uid()
    AND uca.is_active = true
  
  UNION
  
  SELECT 
    p.tenant_id,
    t.name as tenant_name,
    t.subdomain as tenant_subdomain,
    'full'::text as access_level,
    true as is_primary,
    COALESCE(t.is_active, true) as is_active,
    (SELECT COUNT(*) FROM locations WHERE locations.tenant_id = t.id AND locations.is_active = true) as location_count
  FROM profiles p
  JOIN tenants t ON p.tenant_id = t.id
  WHERE p.id = auth.uid()
  
  ORDER BY is_primary DESC, tenant_name ASC;
END;
$$;
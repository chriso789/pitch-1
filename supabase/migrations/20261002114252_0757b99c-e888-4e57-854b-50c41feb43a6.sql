CREATE OR REPLACE FUNCTION public.get_user_accessible_tenants()
 RETURNS TABLE(tenant_id uuid, tenant_name text, tenant_subdomain text, access_level text, is_primary boolean, is_active boolean, location_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_master boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master') INTO v_master;

  RETURN QUERY
  SELECT DISTINCT ON (x.tenant_id) x.* FROM (
    SELECT t.id, t.name, t.subdomain, uca.access_level,
      (t.id = p.tenant_id), COALESCE(t.is_active, true),
      (SELECT COUNT(*) FROM locations l WHERE l.tenant_id = t.id AND l.is_active = true)
    FROM user_company_access uca
    JOIN tenants t ON uca.tenant_id = t.id
    JOIN profiles p ON p.id = auth.uid()
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
    UNION ALL
    SELECT t.id, t.name, t.subdomain, 'full'::text, true, COALESCE(t.is_active, true),
      (SELECT COUNT(*) FROM locations l WHERE l.tenant_id = t.id AND l.is_active = true)
    FROM profiles p JOIN tenants t ON p.tenant_id = t.id
    WHERE p.id = auth.uid()
    UNION ALL
    SELECT t.id, t.name, t.subdomain, 'master'::text,
      (t.id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())), COALESCE(t.is_active, true),
      (SELECT COUNT(*) FROM locations l WHERE l.tenant_id = t.id AND l.is_active = true)
    FROM tenants t WHERE v_master
  ) AS x(tenant_id, tenant_name, tenant_subdomain, access_level, is_primary, is_active, location_count)
  ORDER BY x.tenant_id, x.is_primary DESC;
END;
$function$;
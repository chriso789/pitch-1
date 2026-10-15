CREATE OR REPLACE FUNCTION public.get_user_accessible_tenants()
 RETURNS TABLE(tenant_id uuid, tenant_name text, tenant_subdomain text, access_level text, is_primary boolean, is_active boolean, location_count bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_master boolean; v_home uuid;
BEGIN
  SELECT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'master') INTO v_master;
  SELECT pr.tenant_id INTO v_home FROM profiles pr WHERE pr.id = auth.uid();

  RETURN QUERY
  SELECT DISTINCT ON (x.tid) x.tid, x.tname, x.tsub, x.alevel, x.prim, x.act, x.lcount FROM (
    SELECT t.id AS tid, t.name AS tname, t.subdomain AS tsub, uca.access_level AS alevel,
      (t.id = v_home) AS prim, COALESCE(t.is_active, true) AS act,
      (SELECT COUNT(*) FROM locations l WHERE l.tenant_id = t.id AND l.is_active = true) AS lcount
    FROM user_company_access uca JOIN tenants t ON uca.tenant_id = t.id
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
    UNION ALL
    SELECT t.id, t.name, t.subdomain, 'full'::text, true, COALESCE(t.is_active, true),
      (SELECT COUNT(*) FROM locations l WHERE l.tenant_id = t.id AND l.is_active = true)
    FROM tenants t WHERE t.id = v_home
    UNION ALL
    SELECT t.id, t.name, t.subdomain, 'master'::text, (t.id = v_home), COALESCE(t.is_active, true),
      (SELECT COUNT(*) FROM locations l WHERE l.tenant_id = t.id AND l.is_active = true)
    FROM tenants t WHERE v_master
  ) x
  ORDER BY x.tid, x.prim DESC;
END;
$function$;
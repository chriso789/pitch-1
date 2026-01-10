-- Fix get_user_tenant_ids to include session override and filter out NULLs
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids(p_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT tenant_id FROM (
        -- 1. Session override (most important - matches how app sets active tenant)
        SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid AS tenant_id
        
        UNION ALL
        
        -- 2. Profile's active_tenant_id
        SELECT p.active_tenant_id AS tenant_id
        FROM public.profiles p
        WHERE p.id = p_user_id
        
        UNION ALL
        
        -- 3. Profile's home tenant_id
        SELECT p.tenant_id AS tenant_id
        FROM public.profiles p
        WHERE p.id = p_user_id
        
        UNION ALL
        
        -- 4. All tenants from user_company_access
        SELECT uca.tenant_id
        FROM public.user_company_access uca
        WHERE uca.user_id = p_user_id
        AND uca.is_active = true
      ) AS all_tenants
      WHERE tenant_id IS NOT NULL  -- Filter out NULLs to prevent uuid = ANY(array_with_null) issues
    ),
    '{}'::uuid[]
  );
$$;
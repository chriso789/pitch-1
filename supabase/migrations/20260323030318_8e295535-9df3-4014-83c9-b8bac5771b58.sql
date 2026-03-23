-- Fix security vulnerability: remove session variable override from get_user_tenant_id()
-- The current_setting('app.current_tenant_id', true) allows any authenticated user
-- to SET app.current_tenant_id = '<victim_uuid>' and bypass all tenant isolation.

-- Fix the no-arg version (used by RLS policies)
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid()),
    (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );
$function$;

-- Fix get_user_tenant_ids(p_user_id) — remove session variable override
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids(p_user_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    ARRAY(
      SELECT DISTINCT tenant_id FROM (
        -- 1. Profile's active_tenant_id
        SELECT p.active_tenant_id AS tenant_id
        FROM public.profiles p
        WHERE p.id = p_user_id
        
        UNION ALL
        
        -- 2. Profile's home tenant_id
        SELECT p.tenant_id AS tenant_id
        FROM public.profiles p
        WHERE p.id = p_user_id
        
        UNION ALL
        
        -- 3. All tenants from user_company_access
        SELECT uca.tenant_id
        FROM public.user_company_access uca
        WHERE uca.user_id = p_user_id
        AND uca.is_active = true
      ) AS all_tenants
      WHERE tenant_id IS NOT NULL
    ),
    '{}'::uuid[]
  );
$function$;
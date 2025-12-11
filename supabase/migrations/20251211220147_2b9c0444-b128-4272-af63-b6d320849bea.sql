-- Fix the parameterized get_user_tenant_id function to respect active_tenant_id
-- This ensures company switching properly filters data via RLS policies

CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(active_tenant_id, tenant_id) 
  FROM public.profiles 
  WHERE id = _user_id
  LIMIT 1;
$function$;
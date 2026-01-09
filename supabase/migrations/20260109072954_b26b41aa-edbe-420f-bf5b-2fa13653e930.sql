-- Fast workspace bootstrap function - single RPC call for tenant + role + profile
-- This replaces multiple REST calls during login
CREATE OR REPLACE FUNCTION public.get_workspace_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_role text;
  v_tenant_name text;
  v_result jsonb;
BEGIN
  -- Get profile data
  SELECT id, email, first_name, last_name, title, tenant_id, active_tenant_id, phone, is_developer
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id;
  
  IF v_profile IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Profile not found'
    );
  END IF;
  
  -- Get role from user_roles (ONLY source of truth)
  SELECT role INTO v_role
  FROM public.user_roles
  WHERE user_id = v_user_id
  ORDER BY role ASC
  LIMIT 1;
  
  -- Get tenant name
  SELECT name INTO v_tenant_name
  FROM public.tenants
  WHERE id = COALESCE(v_profile.active_tenant_id, v_profile.tenant_id);
  
  -- Build response
  v_result := jsonb_build_object(
    'success', true,
    'id', v_profile.id,
    'email', v_profile.email,
    'first_name', v_profile.first_name,
    'last_name', v_profile.last_name,
    'title', v_profile.title,
    'phone', v_profile.phone,
    'is_developer', v_profile.is_developer,
    'tenant_id', v_profile.tenant_id,
    'active_tenant_id', COALESCE(v_profile.active_tenant_id, v_profile.tenant_id),
    'company_name', v_tenant_name,
    'role', COALESCE(v_role, '')
  );
  
  RETURN v_result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_workspace_bootstrap() TO authenticated;
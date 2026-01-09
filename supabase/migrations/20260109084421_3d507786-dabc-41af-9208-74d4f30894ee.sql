-- Phase A: Update get_workspace_bootstrap() with email fallback for id mismatch cases
CREATE OR REPLACE FUNCTION public.get_workspace_bootstrap()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_profile record;
  v_role text;
  v_tenant_name text;
  v_result jsonb;
  v_id_mismatch boolean := false;
BEGIN
  -- Get the user's email from the JWT
  v_user_email := auth.jwt() ->> 'email';
  
  -- PRIMARY: Try to get profile by auth user id
  SELECT id, email, first_name, last_name, title, tenant_id, active_tenant_id, phone, is_developer, company_email
  INTO v_profile
  FROM public.profiles
  WHERE id = v_user_id AND is_active = true;
  
  -- FALLBACK: If no profile by id, try by email (handles id mismatch cases)
  IF v_profile IS NULL AND v_user_email IS NOT NULL THEN
    SELECT id, email, first_name, last_name, title, tenant_id, active_tenant_id, phone, is_developer, company_email
    INTO v_profile
    FROM public.profiles
    WHERE (lower(company_email) = lower(v_user_email) OR lower(email) = lower(v_user_email))
      AND is_active = true
    LIMIT 1;
    
    IF v_profile IS NOT NULL THEN
      v_id_mismatch := true;
      RAISE WARNING '[get_workspace_bootstrap] ID MISMATCH: auth.uid=% but profile.id=% (matched by email=%)', v_user_id, v_profile.id, v_user_email;
    END IF;
  END IF;
  
  IF v_profile IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Profile not found',
      'auth_user_id', v_user_id,
      'email_searched', v_user_email
    );
  END IF;
  
  -- Get role from user_roles - try auth.uid first, then profile.id if mismatch
  SELECT role INTO v_role
  FROM public.user_roles
  WHERE user_id = v_user_id
  ORDER BY role ASC
  LIMIT 1;
  
  -- If no role and mismatch, try by profile id
  IF v_role IS NULL AND v_id_mismatch THEN
    SELECT role INTO v_role
    FROM public.user_roles
    WHERE user_id = v_profile.id
    ORDER BY role ASC
    LIMIT 1;
  END IF;
  
  -- Get tenant name
  SELECT name INTO v_tenant_name
  FROM public.tenants
  WHERE id = COALESCE(v_profile.active_tenant_id, v_profile.tenant_id);
  
  -- Build response
  v_result := jsonb_build_object(
    'success', true,
    'id', v_profile.id,
    'auth_user_id', v_user_id,
    'id_mismatch', v_id_mismatch,
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
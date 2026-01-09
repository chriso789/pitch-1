-- Fix has_high_level_role function to check both user_roles AND profiles.role
-- This allows Maria (with profiles.role='owner') to update locations including logo_url

CREATE OR REPLACE FUNCTION public.has_high_level_role(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_role boolean := false;
  v_profile_role text;
BEGIN
  -- Check 1: user_roles table (legacy approach)
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
    AND role IN ('owner', 'master', 'corporate', 'admin', 'office_admin', 'regional_manager', 'sales_manager')
  ) INTO v_has_role;
  
  IF v_has_role THEN
    RETURN true;
  END IF;
  
  -- Check 2: profiles.role column (primary approach for most users)
  SELECT role INTO v_profile_role
  FROM public.profiles
  WHERE id = p_user_id;
  
  IF v_profile_role IN ('owner', 'master', 'corporate', 'admin', 'office_admin', 'regional_manager', 'sales_manager') THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;
-- Fix has_high_level_role function - remove 'admin' reference that doesn't exist in enum
CREATE OR REPLACE FUNCTION public.has_high_level_role(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_has_role boolean := false;
  v_profile_role text;
BEGIN
  -- Check 1: user_roles table (valid enum values only)
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
    AND role IN ('owner'::app_role, 'master'::app_role, 'corporate'::app_role, 'office_admin'::app_role, 'regional_manager'::app_role, 'sales_manager'::app_role)
  ) INTO v_has_role;
  
  IF v_has_role THEN
    RETURN true;
  END IF;
  
  -- Check 2: profiles.role column (text comparison, handles legacy 'admin' values)
  SELECT role::text INTO v_profile_role
  FROM public.profiles
  WHERE id = p_user_id;
  
  IF v_profile_role IN ('owner', 'master', 'corporate', 'office_admin', 'regional_manager', 'sales_manager', 'admin') THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

-- Fix has_role function if it references 'admin' as app_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Update any user_roles entries that somehow have 'admin' (convert to office_admin)
-- This is safe because 'admin' is not a valid enum value, so this should not match anything
-- But we include it for completeness in case data was inserted before enum was fixed
-- Note: This won't actually run since 'admin' can't exist in the role column

-- Add comment to document valid roles
COMMENT ON FUNCTION public.has_high_level_role(uuid) IS 
'Checks if user has a high-level role. Valid roles: master, owner, corporate, office_admin, regional_manager, sales_manager. Does NOT include admin (not a valid app_role enum value).';
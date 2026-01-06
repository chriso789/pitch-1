-- Update has_high_level_role to include owner and manager-level roles
CREATE OR REPLACE FUNCTION public.has_high_level_role(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
$$;

-- Create helper function for manager-level role checks (used in edge functions)
CREATE OR REPLACE FUNCTION public.has_manager_role(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
$$;
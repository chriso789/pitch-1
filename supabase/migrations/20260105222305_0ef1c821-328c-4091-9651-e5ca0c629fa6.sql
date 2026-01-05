
-- Fix profiles RLS policy to include tenant isolation
-- Currently Chris Margarite (owner) can see ALL users across all companies
-- because the policy only checks is_hidden = false without tenant filtering

-- Drop the current policy
DROP POLICY IF EXISTS "profiles_select_with_hidden" ON profiles;

-- Create a security definer function to check if user can view cross-tenant profiles
-- Only master users or platform operators can view all profiles
CREATE OR REPLACE FUNCTION can_view_all_tenants()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'master'
  )
  OR EXISTS (
    SELECT 1 FROM platform_operators 
    WHERE user_id = auth.uid() 
    AND is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND (can_manage_all_companies = true OR is_developer = true)
  )
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION can_view_all_tenants() TO authenticated;

-- Create new policy with proper tenant isolation
CREATE POLICY "profiles_select_with_tenant_isolation" ON profiles
FOR SELECT
USING (
  -- 1. Users can always see their own profile
  id = auth.uid()
  OR
  -- 2. Master users and platform operators can see all profiles
  can_view_all_tenants()
  OR
  -- 3. Regular users can only see profiles in their active tenant (excluding hidden ones)
  (
    tenant_id = get_user_active_tenant_id()
    AND (is_hidden = false OR can_view_hidden_users())
  )
);

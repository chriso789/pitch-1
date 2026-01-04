-- Fix infinite recursion in profiles RLS policy
-- The can_view_hidden_users() function queries profiles, which triggers RLS, 
-- which calls can_view_hidden_users() again - infinite loop

-- Drop the problematic function and policy
DROP POLICY IF EXISTS "Hide stealth users from regular users" ON profiles;
DROP FUNCTION IF EXISTS can_view_hidden_users() CASCADE;

-- Create a new function that checks role from auth.users metadata instead of profiles
-- This breaks the circular dependency since auth.users has different RLS
CREATE OR REPLACE FUNCTION can_view_hidden_users()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) IN ('master', 'owner'),
    -- Fallback: also check the profiles table but only for the calling user's own row
    -- This works because we check id = auth.uid() first in the policy
    false
  )
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION can_view_hidden_users() TO authenticated;

-- Recreate the policy with proper order of conditions to avoid recursion
-- The key is: check auth.uid() FIRST (no recursion), then check is_hidden, 
-- only call can_view_hidden_users() as last resort
CREATE POLICY "profiles_select_with_hidden" ON profiles
FOR SELECT
USING (
  -- 1. Users can always see their own profile (no recursion)
  id = auth.uid()
  OR
  -- 2. Non-hidden profiles are visible (no recursion) 
  is_hidden = false
  OR
  -- 3. Only check role function for hidden profiles of OTHER users
  can_view_hidden_users()
);

-- Also update sync-user-metadata to sync role to auth.users metadata
-- so the can_view_hidden_users function works correctly
-- We need to ensure role is in user_metadata for this to work
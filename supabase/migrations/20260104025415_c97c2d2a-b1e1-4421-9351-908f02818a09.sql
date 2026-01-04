-- ============================================
-- HIDDEN/STEALTH USER FEATURE
-- Allows master/owner to hide users from the team
-- ============================================

-- 1. Add hidden user columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hidden_by UUID REFERENCES auth.users(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

-- 2. Create security definer function to check if user can view hidden users
CREATE OR REPLACE FUNCTION can_view_hidden_users()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('master', 'owner')
  )
$$;

-- 3. Create security definer function to check if a profile should be visible
-- Returns true if profile is visible to the current user
CREATE OR REPLACE FUNCTION is_profile_visible(profile_row profiles)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    -- User can always see their own profile
    profile_row.id = auth.uid()
    OR
    -- Profile is not hidden
    COALESCE(profile_row.is_hidden, false) = false
    OR
    -- User is master/owner and can see hidden users
    can_view_hidden_users()
$$;

-- 4. Drop existing RLS policies on profiles that might conflict
DROP POLICY IF EXISTS "Hide stealth users from regular users" ON profiles;
DROP POLICY IF EXISTS "Users can view profiles in their tenant" ON profiles;
DROP POLICY IF EXISTS "profiles_select_policy" ON profiles;

-- 5. Create new RLS policy that filters hidden users
CREATE POLICY "profiles_select_with_hidden_filter"
ON profiles FOR SELECT
USING (
  -- User can always see their own profile
  id = auth.uid()
  OR (
    -- Profile must not be hidden OR viewer is master/owner
    (COALESCE(is_hidden, false) = false OR can_view_hidden_users())
    AND
    -- Must be in same tenant (existing logic)
    (
      tenant_id IS NULL 
      OR tenant_id IN (
        SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()
        UNION
        SELECT uca.tenant_id FROM user_company_access uca WHERE uca.user_id = auth.uid() AND uca.is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'master'
      )
    )
  )
);

-- 6. Update session_activity_log RLS to hide activity from hidden users
DROP POLICY IF EXISTS "Users and admins can view activity logs" ON session_activity_log;

CREATE POLICY "Users and admins can view activity logs with hidden filter"
ON session_activity_log FOR SELECT
USING (
  -- Users can always see their own logs
  auth.uid() = user_id
  OR
  -- Email match (for backward compatibility)
  email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
  OR
  -- Admins/owners can see logs for non-hidden users in their tenant
  (
    EXISTS (
      SELECT 1 FROM profiles viewer
      WHERE viewer.id = auth.uid()
      AND viewer.role IN ('master', 'corporate', 'owner', 'regional_manager', 'sales_manager')
      AND EXISTS (
        SELECT 1 FROM profiles target_user
        WHERE target_user.id = session_activity_log.user_id
        AND target_user.tenant_id = viewer.tenant_id
        -- Hidden user filter: only master/owner can see hidden user activity
        AND (
          COALESCE(target_user.is_hidden, false) = false 
          OR viewer.role IN ('master', 'owner')
        )
      )
    )
  )
);

-- 7. Create index for performance on is_hidden column
CREATE INDEX IF NOT EXISTS idx_profiles_is_hidden ON profiles(is_hidden) WHERE is_hidden = true;
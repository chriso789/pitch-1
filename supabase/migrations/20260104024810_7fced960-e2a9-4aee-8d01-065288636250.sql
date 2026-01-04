-- Create a new policy that allows:
-- 1. Users to view their own logs
-- 2. Admins/owners to view logs of users in their tenant
CREATE POLICY "Users and admins can view activity logs"
  ON session_activity_log
  FOR SELECT
  USING (
    -- Users can always see their own logs
    auth.uid() = user_id
    OR
    -- Email match (for backward compatibility)
    email = (SELECT email FROM auth.users WHERE id = auth.uid())::text
    OR
    -- Admins and owners can see logs for users in their tenant
    EXISTS (
      SELECT 1 FROM profiles viewer
      WHERE viewer.id = auth.uid()
      AND viewer.role IN ('master', 'corporate', 'owner', 'regional_manager', 'sales_manager')
      AND EXISTS (
        SELECT 1 FROM profiles target_user
        WHERE target_user.id = session_activity_log.user_id
        AND target_user.tenant_id = viewer.tenant_id
      )
    )
  );
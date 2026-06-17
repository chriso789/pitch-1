DROP POLICY IF EXISTS "Users and admins can view activity logs with hidden filter" ON public.session_activity_log;

CREATE POLICY "Users and admins can view activity logs with hidden filter"
ON public.session_activity_log
FOR SELECT
USING (
  (auth.uid() = user_id)
  OR (email = ((SELECT users.email FROM auth.users WHERE users.id = auth.uid()))::text)
  OR (
    -- Master role: full cross-tenant visibility
    EXISTS (
      SELECT 1 FROM profiles viewer
      WHERE viewer.id = auth.uid()
        AND viewer.role = 'master'::app_role
    )
  )
  OR (
    -- Tenant-scoped admin roles
    EXISTS (
      SELECT 1 FROM profiles viewer
      WHERE viewer.id = auth.uid()
        AND viewer.role = ANY (ARRAY['corporate'::app_role, 'owner'::app_role, 'regional_manager'::app_role, 'sales_manager'::app_role])
        AND EXISTS (
          SELECT 1 FROM profiles target_user
          WHERE target_user.id = session_activity_log.user_id
            AND target_user.tenant_id = viewer.tenant_id
            AND (COALESCE(target_user.is_hidden, false) = false OR viewer.role = 'owner'::app_role)
        )
    )
  )
);
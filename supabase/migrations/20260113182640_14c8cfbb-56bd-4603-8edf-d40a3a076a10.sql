-- Fix measurement_approvals RLS policy to use get_user_tenant_id() for consistency
-- This ensures active_tenant_id is properly respected (same as documents table)

DROP POLICY IF EXISTS "Users can access their org approvals" ON measurement_approvals;

CREATE POLICY "Users can access their org approvals"
  ON measurement_approvals FOR ALL
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());
-- Fix measurement_approvals RLS policy to allow INSERT/UPDATE operations
-- The current policy only has USING clause which blocks INSERT/UPDATE by default

DROP POLICY IF EXISTS "Users can access their org approvals" ON measurement_approvals;

-- Recreate with both USING (for SELECT/UPDATE/DELETE) and WITH CHECK (for INSERT/UPDATE)
CREATE POLICY "Users can access their org approvals"
  ON measurement_approvals FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
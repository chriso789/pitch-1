-- Fix Time Entries RLS policies (drop and recreate with correct roles)
DROP POLICY IF EXISTS "Users can view time entries in their tenant" ON time_entries;
DROP POLICY IF EXISTS "Users can insert their own time entries" ON time_entries;
DROP POLICY IF EXISTS "Users can update time entries in their tenant" ON time_entries;
DROP POLICY IF EXISTS "Managers can delete time entries in their tenant" ON time_entries;

-- Time Entries: Users can view their own time entries or all entries if manager
CREATE POLICY "Users can view time entries in their tenant"
ON time_entries
FOR SELECT
USING (
  tenant_id = get_user_tenant_id() AND
  (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.tenant_id = get_user_tenant_id()
      AND profiles.role IN ('master', 'corporate', 'office_admin', 'regional_manager', 'project_manager')
    )
  )
);

-- Time Entries: Users can create their own time entries
CREATE POLICY "Users can create their own time entries"
ON time_entries
FOR INSERT
WITH CHECK (
  tenant_id = get_user_tenant_id() AND
  user_id = auth.uid()
);

-- Time Entries: Users can update their own entries, managers can update any
CREATE POLICY "Users can update time entries"
ON time_entries
FOR UPDATE
USING (
  tenant_id = get_user_tenant_id() AND
  (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.tenant_id = get_user_tenant_id()
      AND profiles.role IN ('master', 'corporate', 'office_admin', 'regional_manager', 'project_manager')
    )
  )
);

-- Time Entries: Admins can delete
CREATE POLICY "Masters can delete time entries in their tenant"
ON time_entries
FOR DELETE
USING (
  tenant_id = get_user_tenant_id() AND
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.tenant_id = get_user_tenant_id()
    AND profiles.role IN ('master', 'corporate')
  )
);
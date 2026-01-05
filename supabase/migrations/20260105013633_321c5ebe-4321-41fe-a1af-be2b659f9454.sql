-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Owners can insert estimate settings" ON tenant_estimate_settings;
DROP POLICY IF EXISTS "Owners can update estimate settings" ON tenant_estimate_settings;

-- Create new INSERT policy allowing managers and above
CREATE POLICY "Managers can insert estimate settings"
ON tenant_estimate_settings
FOR INSERT
WITH CHECK (
  tenant_id IN (
    SELECT COALESCE(profiles.active_tenant_id, profiles.tenant_id)
    FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = ANY (ARRAY['owner'::app_role, 'master'::app_role, 'office_admin'::app_role, 'sales_manager'::app_role, 'regional_manager'::app_role, 'corporate'::app_role])
  )
);

-- Create new UPDATE policy allowing managers and above
CREATE POLICY "Managers can update estimate settings"
ON tenant_estimate_settings
FOR UPDATE
USING (
  tenant_id IN (
    SELECT COALESCE(profiles.active_tenant_id, profiles.tenant_id)
    FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = ANY (ARRAY['owner'::app_role, 'master'::app_role, 'office_admin'::app_role, 'sales_manager'::app_role, 'regional_manager'::app_role, 'corporate'::app_role])
  )
);
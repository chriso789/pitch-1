-- Drop and recreate INSERT policy to include project_manager
DROP POLICY IF EXISTS "Managers can insert estimate settings" ON tenant_estimate_settings;

CREATE POLICY "Managers can insert estimate settings"
ON tenant_estimate_settings
FOR INSERT
WITH CHECK (
  tenant_id IN (
    SELECT COALESCE(profiles.active_tenant_id, profiles.tenant_id)
    FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = ANY (ARRAY[
        'owner'::app_role, 
        'master'::app_role, 
        'office_admin'::app_role, 
        'sales_manager'::app_role, 
        'regional_manager'::app_role, 
        'corporate'::app_role,
        'project_manager'::app_role
      ])
  )
);

-- Also update the UPDATE policy for consistency
DROP POLICY IF EXISTS "Managers can update estimate settings" ON tenant_estimate_settings;

CREATE POLICY "Managers can update estimate settings"
ON tenant_estimate_settings
FOR UPDATE
USING (
  tenant_id IN (
    SELECT COALESCE(profiles.active_tenant_id, profiles.tenant_id)
    FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = ANY (ARRAY[
        'owner'::app_role, 
        'master'::app_role, 
        'office_admin'::app_role, 
        'sales_manager'::app_role, 
        'regional_manager'::app_role, 
        'corporate'::app_role,
        'project_manager'::app_role
      ])
  )
);
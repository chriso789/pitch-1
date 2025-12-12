-- Drop the existing restrictive policy that requires exact tenant_id match
DROP POLICY IF EXISTS "Users can view tab configurations in their tenant" ON settings_tabs;

-- Create new policy that allows global tabs (NULL tenant_id) OR tenant-specific tabs
CREATE POLICY "Users can view global and tenant tab configurations"
ON settings_tabs
FOR SELECT
TO authenticated
USING (
  tenant_id IS NULL  -- Global tabs visible to all
  OR tenant_id = get_user_tenant_id()  -- Tenant-specific tabs (if any)
);
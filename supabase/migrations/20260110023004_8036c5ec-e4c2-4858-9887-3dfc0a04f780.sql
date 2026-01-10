-- Fix API Key RLS Policy to include regional_manager and sales_manager roles
DROP POLICY IF EXISTS "Admins can manage API keys for their tenant" ON company_api_keys;

CREATE POLICY "Admins can manage API keys for their tenant" ON company_api_keys
FOR ALL USING (
  tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
);
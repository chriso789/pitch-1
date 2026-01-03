-- Add missing RLS policies for estimate_calculation_templates table
-- Currently only has SELECT policy, need INSERT, UPDATE, DELETE

-- INSERT policy - allow users to insert templates for their tenant
CREATE POLICY "Tenant users can insert their templates"
ON estimate_calculation_templates
FOR INSERT
WITH CHECK (tenant_id = get_user_tenant_id());

-- UPDATE policy - allow users to update templates for their tenant
CREATE POLICY "Tenant users can update their templates"
ON estimate_calculation_templates
FOR UPDATE
USING (tenant_id = get_user_tenant_id());

-- DELETE policy - allow users to delete templates for their tenant
CREATE POLICY "Tenant users can delete their templates"
ON estimate_calculation_templates
FOR DELETE
USING (tenant_id = get_user_tenant_id());
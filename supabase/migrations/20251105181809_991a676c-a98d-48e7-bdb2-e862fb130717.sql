-- Add RLS policies to labor_cost_tracking
ALTER TABLE labor_cost_tracking ENABLE ROW LEVEL SECURITY;

-- Labor Cost: Managers can view
CREATE POLICY "Managers can view labor cost tracking in their tenant"
ON labor_cost_tracking
FOR SELECT
USING (
  tenant_id = get_user_tenant_id() AND
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.tenant_id = get_user_tenant_id()
    AND profiles.role IN ('master', 'corporate', 'office_admin', 'regional_manager', 'project_manager')
  )
);

-- Labor Cost: System can create
CREATE POLICY "System can create labor cost tracking for tenant"
ON labor_cost_tracking
FOR INSERT
WITH CHECK (tenant_id = get_user_tenant_id());

-- Labor Cost: Managers can update
CREATE POLICY "Managers can update labor cost tracking in their tenant"
ON labor_cost_tracking
FOR UPDATE
USING (
  tenant_id = get_user_tenant_id() AND
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.tenant_id = get_user_tenant_id()
    AND profiles.role IN ('master', 'corporate', 'office_admin', 'regional_manager', 'project_manager')
  )
);

-- Labor Cost: Masters can delete
CREATE POLICY "Masters can delete labor cost tracking in their tenant"
ON labor_cost_tracking
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
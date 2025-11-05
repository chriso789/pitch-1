-- Add RLS policies to safety tables with correct roles
ALTER TABLE safety_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_training ENABLE ROW LEVEL SECURITY;

-- Safety Incidents: All users can view
CREATE POLICY "Users can view safety incidents in their tenant"
ON safety_incidents
FOR SELECT
USING (tenant_id = get_user_tenant_id());

-- Safety Incidents: All users can report
CREATE POLICY "Users can create safety incidents for their tenant"
ON safety_incidents
FOR INSERT
WITH CHECK (tenant_id = get_user_tenant_id());

-- Safety Incidents: Managers can update
CREATE POLICY "Managers can update safety incidents in their tenant"
ON safety_incidents
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

-- Safety Incidents: Masters can delete
CREATE POLICY "Masters can delete safety incidents in their tenant"
ON safety_incidents
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

-- Safety Inspections: All users can view
CREATE POLICY "Users can view safety inspections in their tenant"
ON safety_inspections
FOR SELECT
USING (tenant_id = get_user_tenant_id());

-- Safety Inspections: All users can create
CREATE POLICY "Users can create safety inspections for their tenant"
ON safety_inspections
FOR INSERT
WITH CHECK (tenant_id = get_user_tenant_id());

-- Safety Inspections: Users can update their own, managers can update any
CREATE POLICY "Users can update safety inspections"
ON safety_inspections
FOR UPDATE
USING (
  tenant_id = get_user_tenant_id() AND
  (
    inspector_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.tenant_id = get_user_tenant_id()
      AND profiles.role IN ('master', 'corporate', 'office_admin', 'regional_manager', 'project_manager')
    )
  )
);

-- Safety Inspections: Masters can delete
CREATE POLICY "Masters can delete safety inspections in their tenant"
ON safety_inspections
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

-- Safety Training: Users can view their own, managers can view all
CREATE POLICY "Users can view safety training in their tenant"
ON safety_training
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

-- Safety Training: Managers can create
CREATE POLICY "Managers can create safety training for their tenant"
ON safety_training
FOR INSERT
WITH CHECK (
  tenant_id = get_user_tenant_id() AND
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.tenant_id = get_user_tenant_id()
    AND profiles.role IN ('master', 'corporate', 'office_admin', 'regional_manager', 'project_manager')
  )
);

-- Safety Training: Managers can update
CREATE POLICY "Managers can update safety training in their tenant"
ON safety_training
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

-- Safety Training: Masters can delete
CREATE POLICY "Masters can delete safety training in their tenant"
ON safety_training
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
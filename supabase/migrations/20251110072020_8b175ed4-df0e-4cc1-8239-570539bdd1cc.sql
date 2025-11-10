-- Create company_activity_log table for security audit tracking
CREATE TABLE IF NOT EXISTS company_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'company_switch',
    'data_access',
    'user_login',
    'user_logout',
    'settings_change',
    'permission_change',
    'data_export',
    'bulk_action',
    'critical_operation'
  )),
  action_description TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  ip_address INET,
  user_agent TEXT,
  location_info JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX idx_company_activity_log_tenant ON company_activity_log(tenant_id, created_at DESC);
CREATE INDEX idx_company_activity_log_user ON company_activity_log(user_id, created_at DESC);
CREATE INDEX idx_company_activity_log_action ON company_activity_log(action_type, created_at DESC);
CREATE INDEX idx_company_activity_log_severity ON company_activity_log(severity, created_at DESC);

-- Enable RLS
ALTER TABLE company_activity_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Masters and admins can view all activity logs"
  ON company_activity_log FOR SELECT
  USING (
    tenant_id IN (
      SELECT uca.tenant_id 
      FROM user_company_access uca
      WHERE uca.user_id = auth.uid() AND uca.is_active = true
    )
    AND EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('master', 'office_admin')
    )
  );

CREATE POLICY "System can insert activity logs"
  ON company_activity_log FOR INSERT
  WITH CHECK (true);

-- Update switch_active_tenant to log company switches
CREATE OR REPLACE FUNCTION switch_active_tenant(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_has_access BOOLEAN;
  v_tenant_name TEXT;
  v_previous_tenant_id UUID;
  v_result JSONB;
BEGIN
  -- Get current active tenant before switching
  SELECT active_tenant_id INTO v_previous_tenant_id
  FROM profiles WHERE id = auth.uid();
  
  -- Verify user has access to this tenant
  SELECT EXISTS(
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = p_tenant_id
    UNION
    SELECT 1 FROM user_company_access 
    WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND is_active = true
  ) INTO v_has_access;
  
  IF NOT v_has_access THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied to this company');
  END IF;
  
  -- Get tenant name
  SELECT name INTO v_tenant_name FROM tenants WHERE id = p_tenant_id;
  
  -- Update active tenant
  UPDATE profiles 
  SET active_tenant_id = p_tenant_id 
  WHERE id = auth.uid();
  
  -- Log the company switch in session_activity_log (existing)
  INSERT INTO session_activity_log (
    user_id, 
    email, 
    event_type, 
    success, 
    metadata
  )
  SELECT 
    auth.uid(),
    email,
    'company_switch',
    true,
    jsonb_build_object(
      'from_tenant_id', v_previous_tenant_id,
      'to_tenant_id', p_tenant_id, 
      'tenant_name', v_tenant_name
    )
  FROM profiles WHERE id = auth.uid();
  
  -- Log in company_activity_log (new comprehensive log)
  INSERT INTO company_activity_log (
    tenant_id,
    user_id,
    action_type,
    action_description,
    metadata,
    severity
  )
  VALUES (
    p_tenant_id,
    auth.uid(),
    'company_switch',
    'User switched to ' || v_tenant_name,
    jsonb_build_object(
      'previous_tenant_id', v_previous_tenant_id,
      'new_tenant_id', p_tenant_id,
      'tenant_name', v_tenant_name
    ),
    'info'
  );
  
  RETURN jsonb_build_object(
    'success', true, 
    'tenant_name', v_tenant_name
  );
END;
$$;

-- Function to log user actions
CREATE OR REPLACE FUNCTION log_company_activity(
  p_tenant_id UUID,
  p_action_type TEXT,
  p_action_description TEXT,
  p_resource_type TEXT DEFAULT NULL,
  p_resource_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}',
  p_severity TEXT DEFAULT 'info'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO company_activity_log (
    tenant_id,
    user_id,
    action_type,
    action_description,
    resource_type,
    resource_id,
    metadata,
    severity
  )
  VALUES (
    p_tenant_id,
    auth.uid(),
    p_action_type,
    p_action_description,
    p_resource_type,
    p_resource_id,
    p_metadata,
    p_severity
  )
  RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

COMMENT ON TABLE company_activity_log IS 'Comprehensive audit log for company-level activities including switches, data access, and critical operations';
COMMENT ON FUNCTION log_company_activity IS 'Helper function to log company activities from application code';
-- ============================================
-- STAFF ROUTING & SLA SYSTEM TABLES
-- ============================================

-- Staff routing rules per tenant/location
CREATE TABLE IF NOT EXISTS conversation_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  routing_type TEXT NOT NULL CHECK (routing_type IN (
    'round_robin', 'least_busy', 'skill_based', 'manager_only', 'specific_user'
  )),
  conditions JSONB DEFAULT '{}',
  eligible_users UUID[] DEFAULT '{}',
  fallback_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- SLA configuration per tenant
CREATE TABLE IF NOT EXISTS sla_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'all',
  first_response_minutes INTEGER NOT NULL DEFAULT 60,
  resolution_minutes INTEGER NOT NULL DEFAULT 480,
  escalation_levels JSONB NOT NULL DEFAULT '[]',
  business_hours_only BOOLEAN DEFAULT true,
  business_hours JSONB DEFAULT '{"start": "09:00", "end": "17:00", "days": [1,2,3,4,5]}',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Conversation SLA tracking
CREATE TABLE IF NOT EXISTS conversation_sla_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  conversation_type TEXT NOT NULL CHECK (conversation_type IN ('thread', 'inbox_item', 'sms_thread')),
  sla_policy_id UUID REFERENCES sla_policies(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  first_response_due_at TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  first_response_breached BOOLEAN DEFAULT false,
  resolution_breached BOOLEAN DEFAULT false,
  current_escalation_level INTEGER DEFAULT 0,
  last_escalation_at TIMESTAMPTZ,
  escalation_history JSONB DEFAULT '[]',
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'breached', 'closed')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, conversation_id, conversation_type)
);

-- Staff availability/workload tracking
CREATE TABLE IF NOT EXISTS staff_workload (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  active_conversations INTEGER DEFAULT 0,
  max_conversations INTEGER DEFAULT 20,
  is_available BOOLEAN DEFAULT true,
  availability_status TEXT DEFAULT 'online' CHECK (availability_status IN ('online', 'busy', 'away', 'offline')),
  skills TEXT[] DEFAULT '{}',
  last_assignment_at TIMESTAMPTZ,
  last_round_robin_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_routing_rules_tenant ON conversation_routing_rules(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_routing_rules_priority ON conversation_routing_rules(tenant_id, priority DESC);
CREATE INDEX IF NOT EXISTS idx_sla_policies_tenant ON sla_policies(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sla_status_tenant ON conversation_sla_status(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_sla_status_due ON conversation_sla_status(first_response_due_at, resolution_due_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_sla_status_assigned ON conversation_sla_status(assigned_to) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_staff_workload_available ON staff_workload(tenant_id, is_available) WHERE is_available = true;

-- Enable RLS
ALTER TABLE conversation_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_sla_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_workload ENABLE ROW LEVEL SECURITY;

-- RLS Policies for routing rules (using correct app_role values)
CREATE POLICY "Users can view routing rules for their tenant"
  ON conversation_routing_rules FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage routing rules"
  ON conversation_routing_rules FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles 
      WHERE id = auth.uid() AND role IN ('master', 'owner', 'corporate', 'office_admin')
    )
  );

-- RLS Policies for SLA policies
CREATE POLICY "Users can view SLA policies for their tenant"
  ON sla_policies FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage SLA policies"
  ON sla_policies FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles 
      WHERE id = auth.uid() AND role IN ('master', 'owner', 'corporate', 'office_admin')
    )
  );

-- RLS Policies for SLA status
CREATE POLICY "Users can view SLA status for their tenant"
  ON conversation_sla_status FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update assigned conversations"
  ON conversation_sla_status FOR UPDATE
  USING (
    tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (assigned_to = auth.uid() OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
    ))
  );

CREATE POLICY "Service role can manage all SLA status"
  ON conversation_sla_status FOR ALL
  USING (auth.role() = 'service_role');

-- RLS Policies for staff workload
CREATE POLICY "Users can view staff workload for their tenant"
  ON staff_workload FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their own workload"
  ON staff_workload FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all staff workload"
  ON staff_workload FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles 
      WHERE id = auth.uid() AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
    )
  );

CREATE POLICY "Service role can manage all workload"
  ON staff_workload FOR ALL
  USING (auth.role() = 'service_role');

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_routing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS trigger_routing_rules_updated_at ON conversation_routing_rules;
CREATE TRIGGER trigger_routing_rules_updated_at
  BEFORE UPDATE ON conversation_routing_rules
  FOR EACH ROW EXECUTE FUNCTION update_routing_updated_at();

DROP TRIGGER IF EXISTS trigger_sla_policies_updated_at ON sla_policies;
CREATE TRIGGER trigger_sla_policies_updated_at
  BEFORE UPDATE ON sla_policies
  FOR EACH ROW EXECUTE FUNCTION update_routing_updated_at();

DROP TRIGGER IF EXISTS trigger_sla_status_updated_at ON conversation_sla_status;
CREATE TRIGGER trigger_sla_status_updated_at
  BEFORE UPDATE ON conversation_sla_status
  FOR EACH ROW EXECUTE FUNCTION update_routing_updated_at();

DROP TRIGGER IF EXISTS trigger_staff_workload_updated_at ON staff_workload;
CREATE TRIGGER trigger_staff_workload_updated_at
  BEFORE UPDATE ON staff_workload
  FOR EACH ROW EXECUTE FUNCTION update_routing_updated_at();
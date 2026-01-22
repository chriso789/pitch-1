-- ===============================================================
-- PITCH CRM: 10-PHASE IMPLEMENTATION (Revised)
-- ===============================================================

-- PHASE 1: Manager Approval Gate
ALTER TABLE pipeline_entries 
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS approval_gate_status TEXT;

-- PHASE 2: Measurement Corrections
CREATE TABLE IF NOT EXISTS measurement_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_key TEXT NOT NULL,
  correction_factor DECIMAL(6,4) DEFAULT 1.0000,
  samples_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, location_key)
);

-- PHASE 4: Payment Milestones
CREATE TABLE IF NOT EXISTS payment_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  milestone_name TEXT NOT NULL,
  percentage DECIMAL(5,2),
  amount DECIMAL(12,2) NOT NULL,
  due_trigger TEXT,
  payment_link_url TEXT,
  paid_at TIMESTAMPTZ,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PHASE 6: Weather Alerts & Scheduled Work
CREATE TABLE IF NOT EXISTS production_weather_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT,
  message TEXT,
  weather_data JSONB,
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduled_work_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  weather_status TEXT DEFAULT 'unknown',
  auto_paused BOOLEAN DEFAULT false,
  pause_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, scheduled_date)
);

-- PHASE 7: Validated Addresses
CREATE TABLE IF NOT EXISTS validated_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  address_line1 TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip_code TEXT NOT NULL,
  county TEXT,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  validation_status TEXT DEFAULT 'unverified',
  permit_authority_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PHASE 8: Inspection Requirements
CREATE TABLE IF NOT EXISTS inspection_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inspection_type TEXT NOT NULL,
  required_before_stage TEXT,
  scheduled_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  passed BOOLEAN,
  inspector_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PHASE 9: CLJ Search Function
CREATE OR REPLACE FUNCTION search_by_clj(p_tenant_id UUID, p_clj TEXT)
RETURNS TABLE(entity_type TEXT, entity_id UUID, display_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_c INTEGER; v_l INTEGER;
BEGIN
  v_c := (regexp_match(upper(p_clj), 'C(\d+)'))[1]::INTEGER;
  v_l := (regexp_match(upper(p_clj), 'L(\d+)'))[1]::INTEGER;
  
  RETURN QUERY
  SELECT 'contact'::TEXT, c.id, CONCAT(c.first_name, ' ', c.last_name)
  FROM contacts c
  WHERE c.tenant_id = p_tenant_id
    AND (v_c IS NULL OR c.contact_sequence_number = v_c)
  LIMIT 50;
END;
$$;

-- PHASE 10: QBO Expenses
CREATE TABLE IF NOT EXISTS qbo_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  qbo_expense_id TEXT NOT NULL,
  project_id UUID REFERENCES projects(id),
  vendor_name TEXT,
  amount DECIMAL(12,2) NOT NULL,
  expense_date DATE,
  sync_status TEXT DEFAULT 'synced',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, qbo_expense_id)
);

-- RLS Policies
ALTER TABLE measurement_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_weather_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_work_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE validated_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_access" ON measurement_corrections FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_company_access WHERE user_id = auth.uid() AND is_active = true));
CREATE POLICY "tenant_access" ON payment_milestones FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_company_access WHERE user_id = auth.uid() AND is_active = true));
CREATE POLICY "tenant_access" ON production_weather_alerts FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_company_access WHERE user_id = auth.uid() AND is_active = true));
CREATE POLICY "tenant_access" ON scheduled_work_days FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_company_access WHERE user_id = auth.uid() AND is_active = true));
CREATE POLICY "tenant_access" ON validated_addresses FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_company_access WHERE user_id = auth.uid() AND is_active = true));
CREATE POLICY "tenant_access" ON inspection_requirements FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_company_access WHERE user_id = auth.uid() AND is_active = true));
CREATE POLICY "tenant_access" ON qbo_expenses FOR ALL USING (tenant_id IN (SELECT tenant_id FROM user_company_access WHERE user_id = auth.uid() AND is_active = true));
-- Compliance tracking table
CREATE TABLE IF NOT EXISTS compliance_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('license', 'certification', 'insurance', 'vehicle', 'permit', 'bond')),
  name TEXT NOT NULL,
  number TEXT,
  issuing_authority TEXT,
  assigned_to UUID REFERENCES profiles(id),
  issue_date DATE,
  expiry_date DATE NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'pending_renewal', 'suspended')),
  document_url TEXT,
  notes TEXT,
  alert_days INTEGER DEFAULT 30,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Multi-location support table
CREATE TABLE IF NOT EXISTS business_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  address JSONB,
  territory_geojson JSONB,
  manager_id UUID REFERENCES profiles(id),
  phone TEXT,
  email TEXT,
  is_headquarters BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  settings JSONB DEFAULT '{}',
  lead_routing_rules JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_compliance_items_tenant ON compliance_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_compliance_items_expiry ON compliance_items(expiry_date);
CREATE INDEX IF NOT EXISTS idx_compliance_items_status ON compliance_items(status);
CREATE INDEX IF NOT EXISTS idx_compliance_items_type ON compliance_items(item_type);
CREATE INDEX IF NOT EXISTS idx_business_locations_tenant ON business_locations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_business_locations_status ON business_locations(status);

-- Enable RLS
ALTER TABLE compliance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_locations ENABLE ROW LEVEL SECURITY;

-- RLS policies for compliance_items
CREATE POLICY "Users can view own tenant compliance items"
  ON compliance_items FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert own tenant compliance items"
  ON compliance_items FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own tenant compliance items"
  ON compliance_items FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete own tenant compliance items"
  ON compliance_items FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- RLS policies for business_locations
CREATE POLICY "Users can view own tenant locations"
  ON business_locations FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert own tenant locations"
  ON business_locations FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own tenant locations"
  ON business_locations FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete own tenant locations"
  ON business_locations FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_compliance_items_updated_at
  BEFORE UPDATE ON compliance_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_business_locations_updated_at
  BEFORE UPDATE ON business_locations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
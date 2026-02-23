
CREATE TABLE inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  lead_id UUID REFERENCES pipeline_entries(id),
  canvass_property_id UUID,
  inspected_by UUID REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'in_progress',
  steps_data JSONB NOT NULL DEFAULT '[]',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_access" ON inspections
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

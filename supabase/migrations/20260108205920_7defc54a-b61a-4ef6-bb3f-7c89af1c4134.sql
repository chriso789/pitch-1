-- Create measurement correction factors table to store learned corrections from training data
CREATE TABLE IF NOT EXISTS measurement_correction_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL CHECK (feature_type IN ('ridge', 'hip', 'valley', 'eave', 'rake')),
  correction_multiplier DECIMAL(6,4) DEFAULT 1.0000 NOT NULL,
  sample_count INTEGER DEFAULT 0 NOT NULL,
  confidence DECIMAL(5,4) DEFAULT 0 NOT NULL,
  total_ai_ft DECIMAL(12,2) DEFAULT 0,
  total_manual_ft DECIMAL(12,2) DEFAULT 0,
  avg_variance_pct DECIMAL(8,4) DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, feature_type)
);

-- Enable RLS
ALTER TABLE measurement_correction_factors ENABLE ROW LEVEL SECURITY;

-- RLS policies for measurement_correction_factors
CREATE POLICY "Users can view their tenant's correction factors"
  ON measurement_correction_factors FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert correction factors for their tenant"
  ON measurement_correction_factors FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update their tenant's correction factors"
  ON measurement_correction_factors FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

-- Create index for fast lookups
CREATE INDEX idx_correction_factors_tenant ON measurement_correction_factors(tenant_id);
CREATE INDEX idx_correction_factors_type ON measurement_correction_factors(feature_type);

-- Add comment
COMMENT ON TABLE measurement_correction_factors IS 'Stores learned correction multipliers from training data to improve AI measurement accuracy';
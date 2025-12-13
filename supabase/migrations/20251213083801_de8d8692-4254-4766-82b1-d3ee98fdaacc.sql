-- GPS-Based Measurement System Database Enhancement
-- Add GPS coordinate storage and verification metadata to roof_facets

-- Add GPS-related columns to roof_facets
ALTER TABLE roof_facets ADD COLUMN IF NOT EXISTS polygon_gps_coordinates JSONB;
ALTER TABLE roof_facets ADD COLUMN IF NOT EXISTS edge_segments JSONB;
ALTER TABLE roof_facets ADD COLUMN IF NOT EXISTS measurement_method TEXT DEFAULT 'ai-only' CHECK (measurement_method IN ('ai-only', 'ai-assisted', 'manual'));
ALTER TABLE roof_facets ADD COLUMN IF NOT EXISTS verified_by_user_id UUID REFERENCES auth.users(id);
ALTER TABLE roof_facets ADD COLUMN IF NOT EXISTS verification_confidence TEXT CHECK (verification_confidence IN ('high', 'medium', 'low'));
ALTER TABLE roof_facets ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Add GPS-related columns to roof_measurements
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS image_bounds JSONB;
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS image_source TEXT DEFAULT 'mapbox' CHECK (image_source IN ('google', 'mapbox', 'solar', 'combined'));
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'ai-analyzed', 'manually-verified', 'approved'));
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS gps_accuracy_meters DECIMAL(6,2);

-- Create measurement_verifications table for tracking AI vs manual variance
CREATE TABLE IF NOT EXISTS measurement_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  measurement_id UUID NOT NULL REFERENCES roof_measurements(id) ON DELETE CASCADE,
  verified_by UUID REFERENCES auth.users(id),
  ai_total_sqft DECIMAL(10,2),
  manual_total_sqft DECIMAL(10,2),
  variance_pct DECIMAL(5,2),
  verification_method TEXT NOT NULL CHECK (verification_method IN ('pin-based', 'edge-tracing', 'polygon-import', 'hybrid')),
  edge_classifications JSONB,
  pitch_assignments JSONB,
  validation_passed BOOLEAN DEFAULT false,
  validation_errors JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE measurement_verifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their tenant's verifications"
  ON measurement_verifications FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert their tenant's verifications"
  ON measurement_verifications FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update their tenant's verifications"
  ON measurement_verifications FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_measurement_verifications_measurement_id ON measurement_verifications(measurement_id);
CREATE INDEX IF NOT EXISTS idx_measurement_verifications_tenant_id ON measurement_verifications(tenant_id);

-- Add comment for documentation
COMMENT ON TABLE measurement_verifications IS 'Tracks AI vs manual measurement variance for quality control and training data collection';
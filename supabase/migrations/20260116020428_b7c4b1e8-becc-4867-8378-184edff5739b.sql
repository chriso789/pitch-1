-- ========================================
-- Phase 3: Add vendor report training support
-- ========================================

-- Add ground truth source tracking to training sessions
ALTER TABLE roof_training_sessions 
ADD COLUMN IF NOT EXISTS ground_truth_source TEXT DEFAULT 'manual_trace',
ADD COLUMN IF NOT EXISTS vendor_report_id UUID REFERENCES roof_vendor_reports(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS confidence_weight NUMERIC DEFAULT 1.0;

-- Add constraint to validate ground_truth_source values
ALTER TABLE roof_training_sessions 
DROP CONSTRAINT IF EXISTS roof_training_sessions_ground_truth_source_check;

ALTER TABLE roof_training_sessions 
ADD CONSTRAINT roof_training_sessions_ground_truth_source_check 
CHECK (ground_truth_source IN ('manual_trace', 'vendor_report', 'auto_generated'));

-- Create index for vendor-verified sessions
CREATE INDEX IF NOT EXISTS idx_training_sessions_vendor 
ON roof_training_sessions(vendor_report_id) 
WHERE vendor_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_training_sessions_ground_truth 
ON roof_training_sessions(ground_truth_source);

-- ========================================
-- Regional Correction Factors Table
-- For storing ZIP-code/roof-type specific corrections
-- ========================================

CREATE TABLE IF NOT EXISTS roof_regional_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  zip_prefix TEXT, -- First 3-5 digits of ZIP
  roof_style TEXT, -- 'hip', 'gable', 'complex', 'mixed'
  property_type TEXT DEFAULT 'residential', -- 'residential', 'commercial'
  feature_type TEXT NOT NULL, -- 'ridge', 'hip', 'valley', 'eave', 'rake'
  correction_multiplier NUMERIC NOT NULL DEFAULT 1.0,
  sample_count INTEGER DEFAULT 0,
  confidence NUMERIC DEFAULT 0,
  variance_pct NUMERIC DEFAULT 0,
  total_ai_ft NUMERIC DEFAULT 0,
  total_vendor_ft NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT roof_regional_corrections_unique UNIQUE (tenant_id, zip_prefix, roof_style, property_type, feature_type)
);

-- Enable RLS
ALTER TABLE roof_regional_corrections ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their tenant's corrections
CREATE POLICY "Users can view their tenant's regional corrections"
ON roof_regional_corrections
FOR SELECT
USING (tenant_id IN (
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
));

CREATE POLICY "Users can insert their tenant's regional corrections"
ON roof_regional_corrections
FOR INSERT
WITH CHECK (tenant_id IN (
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
));

CREATE POLICY "Users can update their tenant's regional corrections"
ON roof_regional_corrections
FOR UPDATE
USING (tenant_id IN (
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
));

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_regional_corrections_lookup 
ON roof_regional_corrections(tenant_id, zip_prefix, roof_style, feature_type);

-- ========================================
-- Add geocoding columns to roof_measurements_truth
-- ========================================
ALTER TABLE roof_measurements_truth
ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS geocoding_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS zip_code TEXT;

-- Add comment for documentation
COMMENT ON TABLE roof_regional_corrections IS 'Stores region-specific correction factors learned from vendor reports';
COMMENT ON COLUMN roof_training_sessions.ground_truth_source IS 'Source of ground truth: manual_trace (user sketched), vendor_report (EagleView/Roofr/etc), auto_generated';
COMMENT ON COLUMN roof_training_sessions.vendor_report_id IS 'Link to the vendor report used as ground truth';
COMMENT ON COLUMN roof_training_sessions.confidence_weight IS 'Weight multiplier for this session (vendor reports = 3.0, manual traces = 1.0)';
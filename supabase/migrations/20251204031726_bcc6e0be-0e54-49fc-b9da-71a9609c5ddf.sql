-- Add obstruction detection columns to measurements table
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS obstruction_detected BOOLEAN DEFAULT false;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS obstruction_type TEXT;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS obstruction_confidence DECIMAL(5,2);
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS obstruction_analysis JSONB;
ALTER TABLE measurements ADD COLUMN IF NOT EXISTS obstruction_analyzed_at TIMESTAMPTZ;

-- Create measurement remeasure log table
CREATE TABLE IF NOT EXISTS measurement_remeasure_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_entry_id UUID REFERENCES pipeline_entries(id) ON DELETE CASCADE,
  original_imagery_date DATE,
  new_imagery_date DATE,
  original_values JSONB,
  new_values JSONB,
  variance_pct DECIMAL(5,2),
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  triggered_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create measurement accuracy tracking table
CREATE TABLE IF NOT EXISTS measurement_accuracy_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES measurements(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ai_total_area DECIMAL(10,2),
  manual_total_area DECIMAL(10,2),
  area_variance_pct DECIMAL(5,2),
  ai_ridge_ft DECIMAL(10,2),
  manual_ridge_ft DECIMAL(10,2),
  ridge_variance_pct DECIMAL(5,2),
  ai_hip_ft DECIMAL(10,2),
  manual_hip_ft DECIMAL(10,2),
  hip_variance_pct DECIMAL(5,2),
  ai_valley_ft DECIMAL(10,2),
  manual_valley_ft DECIMAL(10,2),
  valley_variance_pct DECIMAL(5,2),
  overall_accuracy_score DECIMAL(5,2),
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE measurement_remeasure_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_accuracy_tracking ENABLE ROW LEVEL SECURITY;

-- RLS policies for measurement_remeasure_log
CREATE POLICY "Users can view remeasure logs for their pipeline entries"
  ON measurement_remeasure_log FOR SELECT
  USING (
    pipeline_entry_id IN (
      SELECT id FROM pipeline_entries WHERE tenant_id IN (
        SELECT tenant_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can insert remeasure logs"
  ON measurement_remeasure_log FOR INSERT
  WITH CHECK (
    pipeline_entry_id IN (
      SELECT id FROM pipeline_entries WHERE tenant_id IN (
        SELECT tenant_id FROM profiles WHERE id = auth.uid()
      )
    )
  );

-- RLS policies for measurement_accuracy_tracking
CREATE POLICY "Users can view accuracy tracking for their tenant"
  ON measurement_accuracy_tracking FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert accuracy tracking for their tenant"
  ON measurement_accuracy_tracking FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_remeasure_log_pipeline ON measurement_remeasure_log(pipeline_entry_id);
CREATE INDEX IF NOT EXISTS idx_remeasure_log_status ON measurement_remeasure_log(status);
CREATE INDEX IF NOT EXISTS idx_accuracy_tracking_tenant ON measurement_accuracy_tracking(tenant_id);
CREATE INDEX IF NOT EXISTS idx_accuracy_tracking_verified ON measurement_accuracy_tracking(verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurements_imagery_date ON measurements(imagery_date);
CREATE INDEX IF NOT EXISTS idx_measurements_obstruction ON measurements(obstruction_detected);
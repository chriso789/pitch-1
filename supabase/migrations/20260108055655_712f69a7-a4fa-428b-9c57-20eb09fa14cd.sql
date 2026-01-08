-- ============================================
-- ROOF TRAINING LAB SCHEMA
-- Master-only training environment for AI measurement improvement
-- ============================================

-- 1. Main training sessions table
CREATE TABLE IF NOT EXISTS roof_training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  pipeline_entry_id UUID REFERENCES pipeline_entries(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  
  -- Session metadata
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'reviewed')),
  
  -- Property data snapshot
  property_address TEXT,
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  satellite_image_url TEXT,
  
  -- AI comparison reference
  ai_measurement_id UUID REFERENCES roof_measurements(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 2. Individual traced lines (ridge, hip, valley, etc.)
CREATE TABLE IF NOT EXISTS roof_training_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES roof_training_sessions(id) ON DELETE CASCADE,
  
  -- Line data
  trace_type TEXT NOT NULL CHECK (trace_type IN ('ridge', 'hip', 'valley', 'eave', 'rake', 'perimeter')),
  wkt_geometry TEXT NOT NULL,
  length_ft DECIMAL(10, 2) NOT NULL,
  
  -- Visual replay data
  canvas_points JSONB,
  
  -- Metadata
  trace_order INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Screen recordings
CREATE TABLE IF NOT EXISTS roof_training_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES roof_training_sessions(id) ON DELETE CASCADE,
  
  -- Video storage
  video_storage_path TEXT NOT NULL,
  video_url TEXT,
  duration_seconds INTEGER,
  file_size_bytes BIGINT,
  
  -- Metadata
  recording_type TEXT DEFAULT 'tracing' CHECK (recording_type IN ('tracing', 'explanation', 'review')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PDF annotations (EagleView/Roofr reference docs)
CREATE TABLE IF NOT EXISTS roof_training_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES roof_training_sessions(id) ON DELETE CASCADE,
  
  -- PDF storage
  pdf_storage_path TEXT,
  pdf_url TEXT,
  
  -- Annotation data
  annotation_type TEXT CHECK (annotation_type IN ('measurement_report', 'correction', 'example')),
  annotations JSONB,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. AI vs Manual comparison results
CREATE TABLE IF NOT EXISTS roof_training_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES roof_training_sessions(id) ON DELETE CASCADE,
  
  -- Manual totals (from traces)
  manual_ridge_ft DECIMAL(10, 2),
  manual_hip_ft DECIMAL(10, 2),
  manual_valley_ft DECIMAL(10, 2),
  manual_eave_ft DECIMAL(10, 2),
  manual_rake_ft DECIMAL(10, 2),
  manual_perimeter_ft DECIMAL(10, 2),
  manual_total_area_sqft DECIMAL(10, 2),
  
  -- AI totals (from roof_measurements)
  ai_ridge_ft DECIMAL(10, 2),
  ai_hip_ft DECIMAL(10, 2),
  ai_valley_ft DECIMAL(10, 2),
  ai_eave_ft DECIMAL(10, 2),
  ai_rake_ft DECIMAL(10, 2),
  ai_perimeter_ft DECIMAL(10, 2),
  ai_total_area_sqft DECIMAL(10, 2),
  
  -- Variance calculations
  ridge_variance_pct DECIMAL(5, 2),
  hip_variance_pct DECIMAL(5, 2),
  valley_variance_pct DECIMAL(5, 2),
  overall_accuracy_score DECIMAL(5, 2),
  
  -- Error notes for AI improvement
  error_notes JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on all training tables
ALTER TABLE roof_training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_training_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_training_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_training_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_training_comparisons ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Master users only (via profiles role check)
CREATE POLICY "Master users can manage training sessions"
ON roof_training_sessions FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'master'
  )
);

CREATE POLICY "Master users can manage training traces"
ON roof_training_traces FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'master'
  )
);

CREATE POLICY "Master users can manage training recordings"
ON roof_training_recordings FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'master'
  )
);

CREATE POLICY "Master users can manage training annotations"
ON roof_training_annotations FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'master'
  )
);

CREATE POLICY "Master users can manage training comparisons"
ON roof_training_comparisons FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'master'
  )
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_training_sessions_tenant ON roof_training_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_sessions_status ON roof_training_sessions(status);
CREATE INDEX IF NOT EXISTS idx_training_sessions_created_by ON roof_training_sessions(created_by);
CREATE INDEX IF NOT EXISTS idx_training_traces_session ON roof_training_traces(session_id);
CREATE INDEX IF NOT EXISTS idx_training_traces_type ON roof_training_traces(trace_type);

-- Add settings tab entry for Roof Training Lab (master only)
INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 'roof-training', 'Roof Training Lab', 'Train AI measurement system with manual roof tracing', 'GraduationCap', 200, true, ARRAY['master']::text[]
WHERE NOT EXISTS (SELECT 1 FROM settings_tabs WHERE tab_key = 'roof-training');

-- Create storage bucket for training recordings
INSERT INTO storage.buckets (id, name, public)
SELECT 'training-recordings', 'training-recordings', false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'training-recordings');

-- Storage policy: Master users only
DROP POLICY IF EXISTS "Master users can manage training recordings storage" ON storage.objects;
CREATE POLICY "Master users can manage training recordings storage"
ON storage.objects FOR ALL
USING (
  bucket_id = 'training-recordings' 
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role = 'master'
  )
);
-- Phase 6: Learning & Feedback Storage
-- Store corrections to improve future measurements

CREATE TABLE public.measurement_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES public.roof_measurements(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  
  -- Original AI-generated line
  original_line_wkt TEXT NOT NULL,
  original_line_type TEXT NOT NULL CHECK (original_line_type IN ('ridge', 'hip', 'valley', 'eave', 'rake')),
  
  -- Corrected line (from user trace)
  corrected_line_wkt TEXT NOT NULL,
  
  -- Deviation metrics
  deviation_ft DECIMAL(10, 2),
  deviation_pct DECIMAL(5, 2),
  
  -- Context for pattern matching
  correction_source TEXT CHECK (correction_source IN ('user_trace', 'manual_edit', 'auto_correction', 'qa_review')),
  building_shape TEXT, -- 'rectangle', 'L-shape', 'T-shape', 'U-shape', 'complex'
  roof_type TEXT, -- 'gable', 'hip', 'complex', 'flat'
  vertex_count INTEGER,
  
  -- Metadata
  property_address TEXT,
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  correction_notes TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.measurement_corrections ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their corrections
CREATE POLICY "Users can insert their corrections"
ON public.measurement_corrections
FOR INSERT
TO authenticated
WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Allow users to view their tenant's corrections
CREATE POLICY "Users can view their tenant corrections"
ON public.measurement_corrections
FOR SELECT
TO authenticated
USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Create index for querying by shape/type patterns
CREATE INDEX idx_corrections_pattern ON public.measurement_corrections (building_shape, roof_type, original_line_type);
CREATE INDEX idx_corrections_tenant ON public.measurement_corrections (tenant_id, created_at DESC);
CREATE INDEX idx_corrections_measurement ON public.measurement_corrections (measurement_id);

-- Add comment for documentation
COMMENT ON TABLE public.measurement_corrections IS 'Stores corrections to AI-generated roof overlays for continuous learning and accuracy improvement';
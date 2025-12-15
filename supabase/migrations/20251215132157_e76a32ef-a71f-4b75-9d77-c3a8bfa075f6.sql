-- Create roof_edges table (missing from existing schema)
CREATE TABLE IF NOT EXISTS public.roof_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID NOT NULL REFERENCES public.roof_measurements(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  
  edge_type TEXT NOT NULL CHECK (edge_type IN ('ridge', 'hip', 'valley', 'eave', 'rake', 'step_flashing', 'wall_flashing', 'drip_edge')),
  
  -- GPS coordinates
  start_point JSONB NOT NULL,
  end_point JSONB NOT NULL,
  line_wkt TEXT,
  
  -- Measurements
  length_ft DECIMAL(10, 2) NOT NULL,
  
  -- Source tracking
  source TEXT DEFAULT 'ai_detected',
  confidence DECIMAL(5, 2),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.roof_edges ENABLE ROW LEVEL SECURITY;

-- RLS Policies for roof_edges
CREATE POLICY "Users can view roof edges for their org"
  ON public.roof_edges FOR SELECT
  USING (organization_id = public.get_user_tenant_id() OR organization_id IS NULL);

CREATE POLICY "Users can insert roof edges"
  ON public.roof_edges FOR INSERT
  WITH CHECK (organization_id = public.get_user_tenant_id() OR organization_id IS NULL);

CREATE POLICY "Users can update roof edges"
  ON public.roof_edges FOR UPDATE
  USING (organization_id = public.get_user_tenant_id() OR organization_id IS NULL);

CREATE POLICY "Users can delete roof edges"
  ON public.roof_edges FOR DELETE
  USING (organization_id = public.get_user_tenant_id() OR organization_id IS NULL);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_roof_edges_measurement ON public.roof_edges(measurement_id);
CREATE INDEX IF NOT EXISTS idx_roof_edges_type ON public.roof_edges(edge_type);

-- Add any missing columns to roof_measurements
ALTER TABLE public.roof_measurements 
  ADD COLUMN IF NOT EXISTS target_lat DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS target_lng DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS target_method TEXT DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS ai_analysis JSONB,
  ADD COLUMN IF NOT EXISTS gps_analysis JSONB,
  ADD COLUMN IF NOT EXISTS meters_per_pixel DECIMAL(10, 6),
  ADD COLUMN IF NOT EXISTS stories INTEGER DEFAULT 1;
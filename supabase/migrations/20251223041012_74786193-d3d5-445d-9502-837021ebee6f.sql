-- ============================================
-- ROOF MEASUREMENT VERTICES & EDGES SCHEMA
-- For Roofr-quality measurement accuracy
-- ============================================

-- Table to store every detected vertex with classification
CREATE TABLE IF NOT EXISTS public.roof_measurement_vertices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES public.roof_measurements(id) ON DELETE CASCADE,
  
  -- Vertex location (percentage coordinates relative to image)
  x_percent DECIMAL(8, 4) NOT NULL,
  y_percent DECIMAL(8, 4) NOT NULL,
  
  -- Geographic coordinates
  lat DECIMAL(12, 8),
  lng DECIMAL(12, 8),
  
  -- Vertex classification
  -- perimeter: on the roof boundary
  -- interior: inside the roof (ridge-hip junctions, etc.)
  location_type TEXT NOT NULL CHECK (location_type IN ('perimeter', 'interior')),
  
  -- Detailed vertex type for perimeter vertices
  -- hip-corner: where hip line meets eave (creates triangular facet)
  -- valley-entry: where valley line enters from exterior
  -- gable-peak: top of gable end where ridge terminates
  -- eave-corner: where two eave lines meet (rectangular corner)
  -- rake-corner: where rake meets eave
  -- dormer-junction: where dormer connects to main roof
  vertex_type TEXT NOT NULL CHECK (vertex_type IN (
    'hip-corner', 'valley-entry', 'gable-peak', 'eave-corner', 
    'rake-corner', 'dormer-junction',
    'ridge-hip-junction', 'ridge-valley-junction', 'hip-hip-junction',
    'valley-hip-junction', 'ridge-termination', 'hip-peak',
    'unclassified'
  )),
  
  -- Sequence order (for tracing perimeter clockwise)
  sequence_order INTEGER,
  
  -- Connections to other vertices (by id)
  connected_vertex_ids UUID[] DEFAULT '{}',
  
  -- Detection metadata
  detection_confidence DECIMAL(5, 2) DEFAULT 70,
  detection_source TEXT DEFAULT 'ai_vision',
  is_manually_adjusted BOOLEAN DEFAULT FALSE,
  
  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_roof_vertices_measurement ON public.roof_measurement_vertices(measurement_id);
CREATE INDEX IF NOT EXISTS idx_roof_vertices_type ON public.roof_measurement_vertices(vertex_type);
CREATE INDEX IF NOT EXISTS idx_roof_vertices_location ON public.roof_measurement_vertices(location_type);

-- Table to store edges derived from vertices
CREATE TABLE IF NOT EXISTS public.roof_measurement_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES public.roof_measurements(id) ON DELETE CASCADE,
  
  -- Connected vertices
  start_vertex_id UUID REFERENCES public.roof_measurement_vertices(id) ON DELETE CASCADE,
  end_vertex_id UUID REFERENCES public.roof_measurement_vertices(id) ON DELETE CASCADE,
  
  -- Edge classification
  -- eave: horizontal edge at bottom of facet (no ridge/hip intersection)
  -- rake: sloped edge on gable end (ridge terminates here)
  -- ridge: peak line where two opposing facets meet
  -- hip: sloped line from ridge to eave corner
  -- valley: internal corner where two facets meet going inward
  -- step-flashing: where roof meets vertical wall
  -- drip-edge: edge requiring drip edge installation
  edge_type TEXT NOT NULL CHECK (edge_type IN (
    'eave', 'rake', 'ridge', 'hip', 'valley', 
    'step-flashing', 'wall-flashing', 'drip-edge', 'unclassified'
  )),
  
  -- Edge position
  -- perimeter: on the outer boundary
  -- interior: inside the roof (ridges, hips, valleys)
  edge_position TEXT NOT NULL CHECK (edge_position IN ('perimeter', 'interior')),
  
  -- Length in feet (calculated from vertex coordinates)
  length_ft DECIMAL(10, 2) NOT NULL,
  
  -- Associated facets (which facets share this edge)
  left_facet_id UUID,
  right_facet_id UUID,
  
  -- WKT geometry for map overlay
  wkt_geometry TEXT,
  
  -- Detection metadata
  detection_confidence DECIMAL(5, 2) DEFAULT 70,
  detection_source TEXT DEFAULT 'vertex_derived',
  is_manually_adjusted BOOLEAN DEFAULT FALSE,
  
  -- Audit fields
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_roof_edges_measurement ON public.roof_measurement_edges(measurement_id);
CREATE INDEX IF NOT EXISTS idx_roof_edges_type ON public.roof_measurement_edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_roof_edges_start ON public.roof_measurement_edges(start_vertex_id);
CREATE INDEX IF NOT EXISTS idx_roof_edges_end ON public.roof_measurement_edges(end_vertex_id);

-- Add summary fields to roof_measurements for quick access
ALTER TABLE public.roof_measurements 
ADD COLUMN IF NOT EXISTS vertex_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS edge_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS perimeter_vertex_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS interior_vertex_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS hip_corner_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS valley_entry_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS gable_peak_count INTEGER DEFAULT 0;

-- Enable RLS
ALTER TABLE public.roof_measurement_vertices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_measurement_edges ENABLE ROW LEVEL SECURITY;

-- RLS Policies - vertices accessible via measurement
CREATE POLICY "Users can view vertices for accessible measurements"
ON public.roof_measurement_vertices
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
  )
);

CREATE POLICY "Users can insert vertices for accessible measurements"
ON public.roof_measurement_vertices
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
  )
);

CREATE POLICY "Users can update vertices for accessible measurements"
ON public.roof_measurement_vertices
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
  )
);

CREATE POLICY "Users can delete vertices for accessible measurements"
ON public.roof_measurement_vertices
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
  )
);

-- RLS Policies - edges accessible via measurement
CREATE POLICY "Users can view edges for accessible measurements"
ON public.roof_measurement_edges
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
  )
);

CREATE POLICY "Users can insert edges for accessible measurements"
ON public.roof_measurement_edges
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
  )
);

CREATE POLICY "Users can update edges for accessible measurements"
ON public.roof_measurement_edges
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
  )
);

CREATE POLICY "Users can delete edges for accessible measurements"
ON public.roof_measurement_edges
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
  )
);
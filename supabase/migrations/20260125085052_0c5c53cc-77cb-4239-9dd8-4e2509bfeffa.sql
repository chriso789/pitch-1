-- =============================================
-- PHASES 21-40: Advanced AI Measurement Accuracy
-- =============================================

-- Phase 21: Multi-image triangulation results
CREATE TABLE IF NOT EXISTS public.imagery_triangulation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  google_vertices JSONB,
  mapbox_vertices JSONB,
  bing_vertices JSONB,
  google_vertex_count INTEGER DEFAULT 0,
  mapbox_vertex_count INTEGER DEFAULT 0,
  bing_vertex_count INTEGER DEFAULT 0,
  matched_vertices INTEGER DEFAULT 0,
  triangulation_quality TEXT CHECK (triangulation_quality IN ('poor', 'fair', 'good', 'excellent')),
  average_position_error_ft DECIMAL(8,3),
  fused_vertices JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 24: AI confidence calibration
CREATE TABLE IF NOT EXISTS public.ai_confidence_calibration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  component_type TEXT NOT NULL CHECK (component_type IN ('ridge', 'hip', 'valley', 'eave', 'rake', 'perimeter', 'facet')),
  raw_confidence_bin DECIMAL(3,2) NOT NULL,
  actual_accuracy DECIMAL(5,4),
  sample_count INTEGER DEFAULT 0,
  platt_a DECIMAL(10,6),
  platt_b DECIMAL(10,6),
  region TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, component_type, raw_confidence_bin, region)
);

-- Phase 25: Roof dormers
CREATE TABLE IF NOT EXISTS public.roof_dormers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  dormer_type TEXT CHECK (dormer_type IN ('shed', 'gable', 'hip', 'eyebrow', 'barrel', 'flat')),
  position_lat DECIMAL(10,8),
  position_lng DECIMAL(11,8),
  width_ft DECIMAL(8,2),
  height_ft DECIMAL(8,2),
  depth_ft DECIMAL(8,2),
  ridge_direction_degrees DECIMAL(5,2),
  ridge_length_ft DECIMAL(8,2),
  facet_count INTEGER DEFAULT 2,
  area_sqft DECIMAL(10,2),
  valleys_generated JSONB,
  hips_generated JSONB,
  confidence DECIMAL(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 26: Roof obstructions
CREATE TABLE IF NOT EXISTS public.roof_obstructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  obstruction_type TEXT NOT NULL CHECK (obstruction_type IN ('chimney', 'vent', 'pipe', 'hvac', 'skylight', 'solar_panel', 'satellite_dish', 'turbine', 'other')),
  shape TEXT CHECK (shape IN ('rectangle', 'circle', 'polygon')),
  position_lat DECIMAL(10,8),
  position_lng DECIMAL(11,8),
  bounds_wkt TEXT,
  width_ft DECIMAL(8,2),
  depth_ft DECIMAL(8,2),
  area_sqft DECIMAL(10,2),
  flashing_perimeter_ft DECIMAL(10,2),
  flashing_type TEXT,
  requires_cricket BOOLEAN DEFAULT FALSE,
  cricket_area_sqft DECIMAL(8,2),
  confidence DECIMAL(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 28: Step flashing requirements
CREATE TABLE IF NOT EXISTS public.step_flashing_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  segment_type TEXT CHECK (segment_type IN ('sidewall', 'headwall', 'endwall', 'counter', 'apron')),
  length_ft DECIMAL(10,2) NOT NULL,
  start_lat DECIMAL(10,8),
  start_lng DECIMAL(11,8),
  end_lat DECIMAL(10,8),
  end_lng DECIMAL(11,8),
  wkt_line TEXT,
  pitch_at_segment TEXT,
  flashing_height_inches DECIMAL(6,2) DEFAULT 4,
  material_sqft DECIMAL(10,2),
  confidence DECIMAL(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 29: Multi-story roof layers
CREATE TABLE IF NOT EXISTS public.roof_layer_separations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  layer_index INTEGER NOT NULL,
  layer_type TEXT CHECK (layer_type IN ('main', 'upper', 'lower', 'addition', 'garage', 'porch')),
  perimeter_wkt TEXT NOT NULL,
  area_sqft DECIMAL(12,2),
  height_above_grade_ft DECIMAL(8,2),
  height_differential_ft DECIMAL(8,2),
  facet_count INTEGER,
  linear_features JSONB,
  confidence DECIMAL(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 31: Historical imagery comparison
CREATE TABLE IF NOT EXISTS public.imagery_history_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  comparison_years INTEGER[],
  imagery_sources JSONB,
  change_detected BOOLEAN DEFAULT FALSE,
  change_type TEXT CHECK (change_type IN ('none', 'addition', 'modification', 'replacement', 'partial')),
  change_area_sqft DECIMAL(12,2),
  change_location_wkt TEXT,
  consistency_score DECIMAL(4,3),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 33: Real-time feedback tracking
CREATE TABLE IF NOT EXISTS public.ai_feedback_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  feedback_type TEXT CHECK (feedback_type IN ('correction', 'approval', 'rejection', 'partial')),
  original_geometry JSONB,
  corrected_geometry JSONB,
  corrections_made JSONB,
  systematic_bias_detected TEXT,
  region TEXT,
  building_type TEXT,
  time_to_correct_seconds INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 34: Material detection results
CREATE TABLE IF NOT EXISTS public.roof_material_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  detected_material TEXT CHECK (detected_material IN ('asphalt_shingle', 'architectural_shingle', 'metal', 'tile_clay', 'tile_concrete', 'slate', 'wood_shake', 'flat_membrane', 'tpo', 'epdm', 'unknown')),
  confidence DECIMAL(3,2),
  color_detected TEXT,
  texture_pattern TEXT,
  expected_pitch_min DECIMAL(4,2),
  expected_pitch_max DECIMAL(4,2),
  detection_method TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 38: Address-specific learning profiles
CREATE TABLE IF NOT EXISTS public.address_learning_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  address_hash TEXT NOT NULL,
  normalized_address TEXT,
  lat DECIMAL(10,8),
  lng DECIMAL(11,8),
  optimal_detection_params JSONB,
  best_footprint_source TEXT,
  best_imagery_source TEXT,
  historical_accuracy_scores DECIMAL(5,2)[],
  measurement_count INTEGER DEFAULT 0,
  average_accuracy DECIMAL(5,3),
  roof_complexity TEXT,
  known_challenges TEXT[],
  last_measured_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, address_hash)
);

-- Phase 39: Neighborhood pattern analysis
CREATE TABLE IF NOT EXISTS public.neighborhood_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  geohash TEXT NOT NULL,
  center_lat DECIMAL(10,8),
  center_lng DECIMAL(11,8),
  radius_ft DECIMAL(10,2),
  dominant_roof_style TEXT,
  dominant_material TEXT,
  average_pitch TEXT,
  average_area_sqft DECIMAL(12,2),
  property_count INTEGER DEFAULT 0,
  homogeneity_score DECIMAL(4,3),
  calibration_adjustment JSONB,
  last_analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, geohash)
);

-- Phase 40: Measurement certifications
CREATE TABLE IF NOT EXISTS public.measurement_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE UNIQUE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  certification_level TEXT NOT NULL CHECK (certification_level IN ('bronze', 'silver', 'gold', 'platinum')),
  overall_score DECIMAL(5,2) NOT NULL,
  component_scores JSONB,
  critical_checks_passed BOOLEAN DEFAULT FALSE,
  validation_summary JSONB,
  checks_performed JSONB,
  deviations_found JSONB,
  certified_by TEXT CHECK (certified_by IN ('automated', 'qa_reviewed', 'vendor_verified', 'ground_truth_matched')),
  certified_by_user_id UUID REFERENCES auth.users(id),
  certificate_number TEXT UNIQUE,
  valid_until TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  certified_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 37: QA queue management
CREATE TABLE IF NOT EXISTS public.measurement_qa_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  priority_score DECIMAL(5,2) NOT NULL,
  priority_reason TEXT,
  status TEXT CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'corrected', 'escalated')),
  flags JSONB,
  assigned_to UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ,
  review_started_at TIMESTAMPTZ,
  review_completed_at TIMESTAMPTZ,
  review_duration_seconds INTEGER,
  review_notes TEXT,
  corrections_made JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on all new tables
ALTER TABLE public.imagery_triangulation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_confidence_calibration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_dormers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_obstructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.step_flashing_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_layer_separations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imagery_history_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_feedback_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_material_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.address_learning_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.neighborhood_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_qa_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenant isolation
CREATE POLICY "Tenant isolation" ON public.imagery_triangulation_results
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.ai_confidence_calibration
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.roof_dormers
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.roof_obstructions
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.step_flashing_segments
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.roof_layer_separations
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.imagery_history_comparisons
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.ai_feedback_sessions
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.roof_material_detections
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.address_learning_profiles
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.neighborhood_patterns
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.measurement_certifications
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant isolation" ON public.measurement_qa_queue
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Performance indexes
CREATE INDEX idx_triangulation_measurement ON public.imagery_triangulation_results(measurement_id);
CREATE INDEX idx_confidence_calibration_type ON public.ai_confidence_calibration(component_type, raw_confidence_bin);
CREATE INDEX idx_dormers_measurement ON public.roof_dormers(measurement_id);
CREATE INDEX idx_obstructions_measurement ON public.roof_obstructions(measurement_id);
CREATE INDEX idx_flashing_measurement ON public.step_flashing_segments(measurement_id);
CREATE INDEX idx_layers_measurement ON public.roof_layer_separations(measurement_id);
CREATE INDEX idx_history_measurement ON public.imagery_history_comparisons(measurement_id);
CREATE INDEX idx_feedback_measurement ON public.ai_feedback_sessions(measurement_id);
CREATE INDEX idx_feedback_user ON public.ai_feedback_sessions(user_id);
CREATE INDEX idx_material_measurement ON public.roof_material_detections(measurement_id);
CREATE INDEX idx_address_learning_hash ON public.address_learning_profiles(address_hash);
CREATE INDEX idx_address_learning_location ON public.address_learning_profiles(lat, lng);
CREATE INDEX idx_neighborhood_geohash ON public.neighborhood_patterns(geohash);
CREATE INDEX idx_certification_measurement ON public.measurement_certifications(measurement_id);
CREATE INDEX idx_certification_level ON public.measurement_certifications(certification_level);
CREATE INDEX idx_qa_queue_status ON public.measurement_qa_queue(status, priority_score DESC);
CREATE INDEX idx_qa_queue_assigned ON public.measurement_qa_queue(assigned_to, status);
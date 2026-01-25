-- =====================================================
-- MEASUREMENT ACCURACY ENHANCEMENT SCHEMA (Missing Tables Only)
-- 20-Phase Implementation for 99.5% Accuracy
-- =====================================================

-- Phase 1: Ground Truth Calibration System
CREATE TABLE IF NOT EXISTS public.measurement_ground_truth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  lat DECIMAL(10,8),
  lng DECIMAL(11,8),
  source TEXT NOT NULL,
  source_report_url TEXT,
  total_area_sqft DECIMAL(10,2),
  ridge_total_ft DECIMAL(10,2),
  hip_total_ft DECIMAL(10,2),
  valley_total_ft DECIMAL(10,2),
  eave_total_ft DECIMAL(10,2),
  rake_total_ft DECIMAL(10,2),
  drip_edge_total_ft DECIMAL(10,2),
  flashing_total_ft DECIMAL(10,2),
  step_flashing_total_ft DECIMAL(10,2),
  pitch TEXT,
  predominant_pitch_degrees DECIMAL(4,1),
  building_shape TEXT,
  roof_style TEXT,
  facet_count INTEGER,
  stories INTEGER DEFAULT 1,
  raw_report_data JSONB,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 3-6: Linear Feature Classification
CREATE TABLE IF NOT EXISTS public.roof_linear_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  measurement_id UUID,
  feature_type TEXT NOT NULL,
  start_vertex_id UUID,
  end_vertex_id UUID,
  start_lat DECIMAL(10,8) NOT NULL,
  start_lng DECIMAL(11,8) NOT NULL,
  end_lat DECIMAL(10,8) NOT NULL,
  end_lng DECIMAL(11,8) NOT NULL,
  length_ft DECIMAL(10,2) NOT NULL,
  azimuth_degrees DECIMAL(5,2),
  slope_degrees DECIMAL(4,1),
  confidence DECIMAL(3,2),
  detection_source TEXT,
  wkt_geometry TEXT,
  is_validated BOOLEAN DEFAULT FALSE,
  validated_by UUID REFERENCES auth.users(id),
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 10: Deviation Detection Log
CREATE TABLE IF NOT EXISTS public.measurement_deviation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  measurement_id UUID,
  feature_id UUID,
  deviation_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  expected_value DECIMAL(10,2),
  actual_value DECIMAL(10,2),
  deviation_pct DECIMAL(5,2),
  deviation_ft DECIMAL(10,2),
  description TEXT NOT NULL,
  rule_name TEXT,
  auto_resolved BOOLEAN DEFAULT FALSE,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 14: Building Shape Pattern Library
CREATE TABLE IF NOT EXISTS public.roof_shape_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_name TEXT NOT NULL,
  building_shape TEXT NOT NULL,
  roof_style TEXT NOT NULL,
  expected_ridge_count INTEGER,
  expected_hip_count INTEGER,
  expected_valley_count INTEGER,
  ridge_to_hip_ratio DECIMAL(4,2),
  hip_to_valley_ratio DECIMAL(4,2),
  eave_to_rake_ratio DECIMAL(4,2),
  typical_area_range_min DECIMAL(10,2),
  typical_area_range_max DECIMAL(10,2),
  pattern_rules JSONB,
  example_addresses TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 15-16: Correction Training Data
CREATE TABLE IF NOT EXISTS public.measurement_correction_training (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  measurement_id UUID,
  feature_type TEXT NOT NULL,
  original_wkt TEXT,
  corrected_wkt TEXT,
  original_length_ft DECIMAL(10,2),
  corrected_length_ft DECIMAL(10,2),
  deviation_ft DECIMAL(6,2),
  deviation_pct DECIMAL(5,2),
  building_shape TEXT,
  building_area_sqft DECIMAL(10,2),
  roof_style TEXT,
  pitch TEXT,
  correction_type TEXT,
  correction_reason TEXT,
  corrected_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 20: Benchmark Test Cases
CREATE TABLE IF NOT EXISTS public.measurement_benchmark_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address TEXT NOT NULL,
  lat DECIMAL(10,8) NOT NULL,
  lng DECIMAL(11,8) NOT NULL,
  building_shape TEXT NOT NULL,
  roof_style TEXT NOT NULL,
  ground_truth_id UUID,
  expected_area_sqft DECIMAL(10,2) NOT NULL,
  expected_ridge_ft DECIMAL(10,2),
  expected_hip_ft DECIMAL(10,2),
  expected_valley_ft DECIMAL(10,2),
  expected_eave_ft DECIMAL(10,2),
  expected_rake_ft DECIMAL(10,2),
  expected_pitch TEXT,
  difficulty_level TEXT,
  test_category TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 20: Benchmark Results
CREATE TABLE IF NOT EXISTS public.measurement_benchmark_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_run_id UUID NOT NULL,
  case_id UUID,
  measurement_id UUID,
  area_accuracy_pct DECIMAL(5,2),
  ridge_accuracy_pct DECIMAL(5,2),
  hip_accuracy_pct DECIMAL(5,2),
  valley_accuracy_pct DECIMAL(5,2),
  eave_accuracy_pct DECIMAL(5,2),
  rake_accuracy_pct DECIMAL(5,2),
  pitch_accuracy_pct DECIMAL(5,2),
  overall_accuracy_pct DECIMAL(5,2),
  topology_valid BOOLEAN,
  processing_time_ms INTEGER,
  error_message TEXT,
  run_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 20: Benchmark Runs
CREATE TABLE IF NOT EXISTS public.measurement_benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT,
  total_cases INTEGER,
  passed_cases INTEGER,
  failed_cases INTEGER,
  avg_area_accuracy DECIMAL(5,2),
  avg_ridge_accuracy DECIMAL(5,2),
  avg_hip_accuracy DECIMAL(5,2),
  avg_valley_accuracy DECIMAL(5,2),
  avg_overall_accuracy DECIMAL(5,2),
  min_accuracy DECIMAL(5,2),
  max_accuracy DECIMAL(5,2),
  regression_detected BOOLEAN DEFAULT FALSE,
  regression_details JSONB,
  run_duration_ms INTEGER,
  triggered_by UUID REFERENCES auth.users(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Phase 7: Footprint Fusion Source Tracking
CREATE TABLE IF NOT EXISTS public.footprint_fusion_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID,
  source_name TEXT NOT NULL,
  polygon_wkt TEXT NOT NULL,
  area_sqft DECIMAL(10,2),
  vertex_count INTEGER,
  confidence DECIMAL(3,2),
  weight_applied DECIMAL(3,2),
  included_in_fusion BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 8: Calibration Factors
CREATE TABLE IF NOT EXISTS public.measurement_calibration_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  region TEXT,
  lat_min DECIMAL(10,8),
  lat_max DECIMAL(10,8),
  lng_min DECIMAL(11,8),
  lng_max DECIMAL(11,8),
  elevation_ft DECIMAL(8,2),
  pixel_to_ft_ratio DECIMAL(8,6),
  mercator_correction DECIMAL(8,6),
  zoom_level INTEGER,
  calibration_source TEXT,
  validated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on new tables
ALTER TABLE public.measurement_ground_truth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_linear_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_deviation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_correction_training ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_benchmark_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_benchmark_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_benchmark_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.footprint_fusion_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_calibration_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roof_shape_patterns ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist and recreate
DROP POLICY IF EXISTS "tenant_ground_truth" ON public.measurement_ground_truth;
DROP POLICY IF EXISTS "tenant_linear_features" ON public.roof_linear_features;
DROP POLICY IF EXISTS "tenant_deviation_log" ON public.measurement_deviation_log;
DROP POLICY IF EXISTS "tenant_correction_training" ON public.measurement_correction_training;
DROP POLICY IF EXISTS "read_benchmark_cases" ON public.measurement_benchmark_cases;
DROP POLICY IF EXISTS "read_benchmark_results" ON public.measurement_benchmark_results;
DROP POLICY IF EXISTS "read_benchmark_runs" ON public.measurement_benchmark_runs;
DROP POLICY IF EXISTS "read_shape_patterns" ON public.roof_shape_patterns;

-- Create RLS policies
CREATE POLICY "tenant_ground_truth" ON public.measurement_ground_truth
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "tenant_linear_features" ON public.roof_linear_features
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "tenant_deviation_log" ON public.measurement_deviation_log
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "tenant_correction_training" ON public.measurement_correction_training
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "read_benchmark_cases" ON public.measurement_benchmark_cases
  FOR SELECT USING (true);

CREATE POLICY "read_benchmark_results" ON public.measurement_benchmark_results
  FOR SELECT USING (true);

CREATE POLICY "read_benchmark_runs" ON public.measurement_benchmark_runs
  FOR SELECT USING (true);

CREATE POLICY "read_shape_patterns" ON public.roof_shape_patterns
  FOR SELECT USING (true);

-- Insert seed data for building shape patterns
INSERT INTO public.roof_shape_patterns (pattern_name, building_shape, roof_style, expected_ridge_count, expected_hip_count, expected_valley_count, ridge_to_hip_ratio, pattern_rules) VALUES
('Simple Gable', 'rectangle', 'gable', 1, 0, 0, NULL, '{"perimeter_edges": 4, "has_rakes": true, "has_gable_ends": true}'),
('Simple Hip', 'rectangle', 'hip', 1, 4, 0, 0.25, '{"perimeter_edges": 4, "all_eaves": true, "hip_angle": 45}'),
('L-Shape Hip', 'l_shape', 'hip', 2, 8, 1, 0.25, '{"perimeter_edges": 6, "valley_at_intersection": true}'),
('L-Shape Gable', 'l_shape', 'gable', 2, 0, 1, NULL, '{"perimeter_edges": 6, "valley_at_intersection": true, "has_rakes": true}'),
('T-Shape Hip', 't_shape', 'hip', 3, 10, 2, 0.30, '{"perimeter_edges": 8, "valleys_at_intersections": true}'),
('T-Shape Gable', 't_shape', 'gable', 3, 0, 2, NULL, '{"perimeter_edges": 8, "valleys_at_intersections": true, "has_rakes": true}'),
('U-Shape Hip', 'u_shape', 'hip', 2, 8, 2, 0.25, '{"perimeter_edges": 8, "valleys_at_wings": true}'),
('Complex Multi-Wing', 'complex', 'combination', 4, 12, 3, 0.33, '{"variable_geometry": true, "manual_review_recommended": true}')
ON CONFLICT DO NOTHING;
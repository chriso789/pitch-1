-- ============================================
-- PHASES 41-70: ULTIMATE MEASUREMENT ACCURACY SYSTEM
-- Path to 100% Accuracy Through Advanced AI
-- ============================================

-- Phase 41: Parsed vendor reports for deep data extraction
CREATE TABLE IF NOT EXISTS public.parsed_vendor_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  vendor TEXT NOT NULL CHECK (vendor IN ('eagleview', 'roofr', 'hover', 'xactimate', 'gaf', 'owens_corning', 'other')),
  report_version TEXT,
  raw_pdf_url TEXT,
  extracted_data JSONB NOT NULL DEFAULT '{}',
  extraction_confidence DECIMAL(5,2),
  field_count_extracted INTEGER DEFAULT 0,
  field_count_total INTEGER DEFAULT 0,
  parsing_method TEXT,
  parsing_errors JSONB DEFAULT '[]',
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 42: Segment-level ground truth for per-segment calibration
CREATE TABLE IF NOT EXISTS public.segment_ground_truth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ground_truth_id UUID REFERENCES measurement_ground_truth(id) ON DELETE CASCADE,
  segment_type TEXT NOT NULL CHECK (segment_type IN ('ridge', 'hip', 'valley', 'eave', 'rake', 'step_flashing', 'drip_edge')),
  segment_index INTEGER NOT NULL,
  start_lat DECIMAL(10,8),
  start_lng DECIMAL(11,8),
  end_lat DECIMAL(10,8),
  end_lng DECIMAL(11,8),
  length_ft DECIMAL(8,2) NOT NULL,
  azimuth_degrees DECIMAL(5,2),
  pitch_at_segment TEXT,
  connected_to_segments INTEGER[] DEFAULT '{}',
  confidence DECIMAL(3,2) DEFAULT 1.0,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 43: Elevation data integration from LiDAR/3DEP
CREATE TABLE IF NOT EXISTS public.measurement_elevation_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  ground_elevation_ft DECIMAL(10,2),
  ridge_elevation_ft DECIMAL(10,2),
  eave_elevation_ft DECIMAL(10,2),
  calculated_ridge_height_ft DECIMAL(8,2),
  elevation_derived_pitch TEXT,
  pitch_confidence DECIMAL(3,2),
  data_source TEXT CHECK (data_source IN ('usgs_3dep', 'lidar', 'photogrammetry', 'estimated')),
  data_quality TEXT CHECK (data_quality IN ('high', 'medium', 'low', 'unknown')),
  resolution_meters DECIMAL(6,2),
  acquisition_date DATE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 44: Permit record cross-reference
CREATE TABLE IF NOT EXISTS public.permit_measurement_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  permit_number TEXT,
  permit_date DATE,
  county_name TEXT,
  state_code TEXT,
  permitted_roof_area_sqft DECIMAL(10,2),
  permitted_stories INTEGER,
  permit_type TEXT,
  modifications_noted TEXT[],
  discrepancy_detected BOOLEAN DEFAULT false,
  discrepancy_description TEXT,
  permit_document_url TEXT,
  validation_status TEXT CHECK (validation_status IN ('matched', 'discrepancy', 'not_found', 'pending')),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 45: Temporal imagery analysis
CREATE TABLE IF NOT EXISTS public.temporal_imagery_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  imagery_dates DATE[] NOT NULL,
  imagery_sources TEXT[] DEFAULT '{}',
  vertex_consistency_score DECIMAL(5,2),
  perimeter_consistency_score DECIMAL(5,2),
  area_consistency_score DECIMAL(5,2),
  changes_detected BOOLEAN DEFAULT false,
  change_type TEXT CHECK (change_type IN ('none', 'addition', 'removal', 'modification', 'new_construction')),
  change_description TEXT,
  change_area_sqft DECIMAL(10,2),
  anchor_vertices JSONB DEFAULT '[]',
  high_confidence_segments JSONB DEFAULT '[]',
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 46: Street view pitch verification
CREATE TABLE IF NOT EXISTS public.street_view_pitch_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  street_view_urls TEXT[] DEFAULT '{}',
  viewing_angles DECIMAL(5,2)[] DEFAULT '{}',
  detected_pitches TEXT[] DEFAULT '{}',
  average_street_view_pitch TEXT,
  pitch_confidence DECIMAL(3,2),
  agrees_with_aerial BOOLEAN,
  aerial_pitch TEXT,
  discrepancy_degrees DECIMAL(5,2),
  quality_score DECIMAL(3,2),
  analysis_notes TEXT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 47: Insurance claim data integration
CREATE TABLE IF NOT EXISTS public.insurance_claim_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  claim_number TEXT,
  carrier_name TEXT,
  adjuster_name TEXT,
  claim_date DATE,
  adjuster_roof_area_sqft DECIMAL(10,2),
  adjuster_pitch TEXT,
  adjuster_linear_totals JSONB DEFAULT '{}',
  scope_items JSONB DEFAULT '[]',
  damage_areas JSONB DEFAULT '[]',
  accuracy_match_pct DECIMAL(5,2),
  validation_status TEXT CHECK (validation_status IN ('matched', 'review_needed', 'discrepancy', 'pending')),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 48-55: AI precision metrics
CREATE TABLE IF NOT EXISTS public.ai_detection_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  pass_number INTEGER NOT NULL,
  prompt_variation TEXT,
  temperature DECIMAL(3,2),
  detected_vertices JSONB DEFAULT '[]',
  detected_segments JSONB DEFAULT '[]',
  detected_facets JSONB DEFAULT '[]',
  confidence_scores JSONB DEFAULT '{}',
  processing_time_ms INTEGER,
  model_version TEXT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 52: Spectral analysis results
CREATE TABLE IF NOT EXISTS public.spectral_analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  detected_material TEXT CHECK (detected_material IN ('asphalt_shingle', 'metal', 'tile_clay', 'tile_concrete', 'slate', 'wood_shake', 'flat_membrane', 'unknown')),
  material_confidence DECIMAL(3,2),
  color_profile JSONB DEFAULT '{}',
  spectral_signature JSONB DEFAULT '{}',
  estimated_roof_age_years INTEGER,
  condition_score DECIMAL(3,2),
  degradation_indicators TEXT[],
  edge_detection_adjustment DECIMAL(4,2) DEFAULT 1.0,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 56: Self-correction log
CREATE TABLE IF NOT EXISTS public.measurement_self_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  correction_type TEXT NOT NULL,
  original_geometry JSONB,
  corrected_geometry JSONB,
  correction_reason TEXT,
  confidence_before DECIMAL(3,2),
  confidence_after DECIMAL(3,2),
  auto_applied BOOLEAN DEFAULT true,
  human_reviewed BOOLEAN DEFAULT false,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 57: Accuracy regression tracking
CREATE TABLE IF NOT EXISTS public.accuracy_regression_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  metric_name TEXT NOT NULL,
  component_type TEXT,
  baseline_value DECIMAL(8,4),
  current_value DECIMAL(8,4),
  regression_pct DECIMAL(5,2),
  sample_size INTEGER,
  severity TEXT CHECK (severity IN ('minor', 'moderate', 'severe', 'critical')),
  investigation_status TEXT CHECK (investigation_status IN ('detected', 'investigating', 'identified', 'resolved', 'monitoring')),
  root_cause TEXT,
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE
);

-- Phase 58: Synthetic test cases
CREATE TABLE IF NOT EXISTS public.synthetic_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name TEXT NOT NULL,
  roof_type TEXT NOT NULL,
  complexity_level TEXT CHECK (complexity_level IN ('simple', 'moderate', 'complex', 'extreme')),
  synthetic_geometry JSONB NOT NULL,
  expected_measurements JSONB NOT NULL,
  synthetic_image_url TEXT,
  last_run_at TIMESTAMPTZ,
  last_run_passed BOOLEAN,
  last_run_accuracy DECIMAL(5,2),
  run_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 59: Field technician corrections
CREATE TABLE IF NOT EXISTS public.field_technician_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  technician_id UUID,
  correction_type TEXT NOT NULL,
  original_value JSONB,
  corrected_value JSONB,
  gps_lat DECIMAL(10,8),
  gps_lng DECIMAL(11,8),
  photo_urls TEXT[] DEFAULT '{}',
  notes TEXT,
  technician_confidence DECIMAL(3,2),
  technician_accuracy_weight DECIMAL(3,2) DEFAULT 1.0,
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 60: Edge case detection
CREATE TABLE IF NOT EXISTS public.detected_edge_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  edge_case_type TEXT NOT NULL,
  detection_confidence DECIMAL(3,2),
  description TEXT,
  handling_strategy TEXT,
  routed_to TEXT CHECK (routed_to IN ('specialized_pipeline', 'human_review', 'standard_with_flag')),
  resolution_status TEXT CHECK (resolution_status IN ('pending', 'in_progress', 'resolved', 'unresolvable')),
  resolution_notes TEXT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 62: Measurement algorithm versions
CREATE TABLE IF NOT EXISTS public.measurement_algorithm_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  version_major INTEGER NOT NULL,
  version_minor INTEGER NOT NULL,
  version_patch INTEGER NOT NULL,
  description TEXT,
  changelog TEXT[],
  calibration_params JSONB DEFAULT '{}',
  prompt_templates JSONB DEFAULT '{}',
  activated_at TIMESTAMPTZ,
  deactivated_at TIMESTAMPTZ,
  is_current BOOLEAN DEFAULT false,
  measurements_count INTEGER DEFAULT 0,
  accuracy_score DECIMAL(5,2),
  rollback_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 66: Measurement annotations
CREATE TABLE IF NOT EXISTS public.measurement_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  annotation_type TEXT NOT NULL CHECK (annotation_type IN ('error_description', 'correction_explanation', 'training_note', 'quality_flag', 'edge_case_note')),
  target_type TEXT CHECK (target_type IN ('vertex', 'segment', 'facet', 'overall', 'pitch', 'area')),
  target_id TEXT,
  target_coordinates JSONB,
  content TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  is_training_example BOOLEAN DEFAULT false,
  created_by UUID,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 67: Reviewer performance tracking
CREATE TABLE IF NOT EXISTS public.reviewer_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id UUID NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  measurements_reviewed INTEGER DEFAULT 0,
  corrections_made INTEGER DEFAULT 0,
  corrections_validated INTEGER DEFAULT 0,
  corrections_rejected INTEGER DEFAULT 0,
  accuracy_score DECIMAL(5,2),
  average_review_time_seconds INTEGER,
  complex_reviews_count INTEGER DEFAULT 0,
  calibration_test_score DECIMAL(5,2),
  calibration_test_date DATE,
  performance_tier TEXT CHECK (performance_tier IN ('trainee', 'standard', 'senior', 'expert')),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(reviewer_id, period_start, period_end)
);

-- Phase 63: Verification routing decisions
CREATE TABLE IF NOT EXISTS public.verification_routing_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE,
  routing_decision TEXT NOT NULL CHECK (routing_decision IN ('auto_approve', 'standard_review', 'senior_review', 'expert_review', 'manual_only')),
  confidence_score DECIMAL(3,2),
  complexity_score DECIMAL(3,2),
  value_score DECIMAL(3,2),
  risk_score DECIMAL(3,2),
  routing_factors JSONB DEFAULT '{}',
  assigned_reviewer_id UUID,
  review_deadline TIMESTAMPTZ,
  review_started_at TIMESTAMPTZ,
  review_completed_at TIMESTAMPTZ,
  review_outcome TEXT CHECK (review_outcome IN ('approved', 'corrected', 'rejected', 'escalated')),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 69: Diamond certifications (100% accuracy)
CREATE TABLE IF NOT EXISTS public.diamond_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES roof_measurements(id) ON DELETE CASCADE UNIQUE,
  certification_number TEXT UNIQUE NOT NULL,
  area_accuracy_pct DECIMAL(6,3) NOT NULL,
  linear_accuracy_pct DECIMAL(6,3) NOT NULL,
  pitch_accuracy_score DECIMAL(5,2) NOT NULL,
  topology_score INTEGER NOT NULL CHECK (topology_score >= 0 AND topology_score <= 100),
  all_validations_passed BOOLEAN NOT NULL DEFAULT true,
  expert_reviewer_id UUID,
  expert_review_notes TEXT,
  ground_truth_source TEXT,
  certified_at TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  certificate_pdf_url TEXT,
  certificate_hash TEXT,
  revoked BOOLEAN DEFAULT false,
  revoked_reason TEXT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE
);

-- Phase 70: Improvement flywheel metrics
CREATE TABLE IF NOT EXISTS public.improvement_flywheel_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  metric_type TEXT NOT NULL CHECK (metric_type IN ('daily', 'weekly', 'monthly', 'quarterly')),
  total_measurements INTEGER DEFAULT 0,
  ground_truth_ingested INTEGER DEFAULT 0,
  calibrations_updated INTEGER DEFAULT 0,
  error_patterns_identified INTEGER DEFAULT 0,
  training_examples_generated INTEGER DEFAULT 0,
  edge_cases_resolved INTEGER DEFAULT 0,
  accuracy_improvement_pct DECIMAL(5,3),
  diamond_certification_rate DECIMAL(5,2),
  auto_approval_rate DECIMAL(5,2),
  human_review_rate DECIMAL(5,2),
  average_accuracy DECIMAL(5,2),
  notes TEXT,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(metric_date, metric_type, tenant_id)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_parsed_vendor_reports_measurement ON parsed_vendor_reports(measurement_id);
CREATE INDEX IF NOT EXISTS idx_parsed_vendor_reports_vendor ON parsed_vendor_reports(vendor);
CREATE INDEX IF NOT EXISTS idx_segment_ground_truth_type ON segment_ground_truth(segment_type);
CREATE INDEX IF NOT EXISTS idx_temporal_imagery_changes ON temporal_imagery_analysis(changes_detected) WHERE changes_detected = true;
CREATE INDEX IF NOT EXISTS idx_self_corrections_measurement ON measurement_self_corrections(measurement_id);
CREATE INDEX IF NOT EXISTS idx_regression_log_severity ON accuracy_regression_log(severity, investigation_status);
CREATE INDEX IF NOT EXISTS idx_field_corrections_unprocessed ON field_technician_corrections(processed) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_edge_cases_pending ON detected_edge_cases(resolution_status) WHERE resolution_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_algorithm_versions_current ON measurement_algorithm_versions(is_current) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_annotations_measurement ON measurement_annotations(measurement_id);
CREATE INDEX IF NOT EXISTS idx_annotations_training ON measurement_annotations(is_training_example) WHERE is_training_example = true;
CREATE INDEX IF NOT EXISTS idx_reviewer_performance_reviewer ON reviewer_performance(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_verification_routing_pending ON verification_routing_decisions(review_outcome) WHERE review_outcome IS NULL;
CREATE INDEX IF NOT EXISTS idx_diamond_certifications_valid ON diamond_certifications(revoked) WHERE revoked = false;
CREATE INDEX IF NOT EXISTS idx_flywheel_metrics_date ON improvement_flywheel_metrics(metric_date, metric_type);
CREATE INDEX IF NOT EXISTS idx_ai_detection_passes_measurement ON ai_detection_passes(measurement_id);
CREATE INDEX IF NOT EXISTS idx_spectral_analysis_material ON spectral_analysis_results(detected_material);

-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

ALTER TABLE parsed_vendor_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment_ground_truth ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_elevation_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE permit_measurement_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporal_imagery_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE street_view_pitch_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_claim_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_detection_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE spectral_analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_self_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE accuracy_regression_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_technician_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE detected_edge_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_algorithm_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewer_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_routing_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE diamond_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE improvement_flywheel_metrics ENABLE ROW LEVEL SECURITY;

-- Policies for tenant isolation
CREATE POLICY "Tenant isolation for parsed_vendor_reports" ON parsed_vendor_reports FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for segment_ground_truth" ON segment_ground_truth FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for measurement_elevation_data" ON measurement_elevation_data FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for permit_measurement_matches" ON permit_measurement_matches FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for temporal_imagery_analysis" ON temporal_imagery_analysis FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for street_view_pitch_analysis" ON street_view_pitch_analysis FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for insurance_claim_measurements" ON insurance_claim_measurements FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for ai_detection_passes" ON ai_detection_passes FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for spectral_analysis_results" ON spectral_analysis_results FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for measurement_self_corrections" ON measurement_self_corrections FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for accuracy_regression_log" ON accuracy_regression_log FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for field_technician_corrections" ON field_technician_corrections FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for detected_edge_cases" ON detected_edge_cases FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for measurement_annotations" ON measurement_annotations FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for reviewer_performance" ON reviewer_performance FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for verification_routing_decisions" ON verification_routing_decisions FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for diamond_certifications" ON diamond_certifications FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for improvement_flywheel_metrics" ON improvement_flywheel_metrics FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Public read for synthetic test cases and algorithm versions (global resources)
CREATE POLICY "Public read for synthetic_test_cases" ON synthetic_test_cases FOR SELECT USING (true);
CREATE POLICY "Public read for measurement_algorithm_versions" ON measurement_algorithm_versions FOR SELECT USING (true);
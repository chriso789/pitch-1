-- ============================================================================
-- PITCH CRM: AI ROOF MEASUREMENT SYSTEM - COMPLETE DATABASE SCHEMA
-- Version: 1.0.0
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- MAIN TABLES
-- ============================================================================

-- 1. ROOF MEASUREMENTS (Primary measurement records)
CREATE TABLE IF NOT EXISTS roof_measurements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Relationships
  customer_id UUID,
  measured_by UUID REFERENCES auth.users(id),
  organization_id UUID,
  
  -- Property Info
  property_address TEXT NOT NULL,
  property_city TEXT,
  property_state TEXT,
  property_zip TEXT,
  gps_coordinates JSONB NOT NULL,
  
  -- Image Sources
  google_maps_image_url TEXT,
  google_maps_zoom_level INTEGER DEFAULT 20,
  mapbox_image_url TEXT,
  selected_image_source TEXT DEFAULT 'google_maps',
  image_quality_score INTEGER CHECK (image_quality_score BETWEEN 1 AND 10),
  
  -- Solar API Data
  solar_api_available BOOLEAN DEFAULT false,
  solar_building_footprint_sqft DECIMAL(10,2),
  solar_panel_count INTEGER,
  solar_api_response JSONB,
  
  -- AI Analysis
  ai_detection_data JSONB NOT NULL,
  ai_model_version TEXT DEFAULT 'gpt-4-vision-preview',
  detection_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  detection_confidence DECIMAL(5,2) CHECK (detection_confidence BETWEEN 0 AND 100),
  
  -- Roof Structure
  roof_type TEXT CHECK (roof_type IN ('gable', 'hip', 'flat', 'gambrel', 'mansard', 'complex')),
  predominant_pitch TEXT,
  pitch_degrees DECIMAL(5,2),
  pitch_multiplier DECIMAL(5,3),
  facet_count INTEGER,
  complexity_rating TEXT CHECK (complexity_rating IN ('simple', 'moderate', 'complex', 'very_complex')),
  
  -- Measurements
  total_area_flat_sqft DECIMAL(10,2),
  total_area_adjusted_sqft DECIMAL(10,2),
  total_squares DECIMAL(10,2),
  waste_factor_percent DECIMAL(5,2) DEFAULT 10.00,
  total_squares_with_waste DECIMAL(10,2),
  
  -- Scale
  pixels_per_foot DECIMAL(10,4),
  scale_confidence TEXT CHECK (scale_confidence IN ('high', 'medium', 'low')),
  scale_method TEXT,
  
  -- Validation
  measurement_confidence DECIMAL(5,2) CHECK (measurement_confidence BETWEEN 0 AND 100),
  api_variance_percent DECIMAL(5,2),
  validation_status TEXT CHECK (validation_status IN ('pending', 'validated', 'flagged', 'rejected')),
  validation_notes TEXT,
  requires_manual_review BOOLEAN DEFAULT false,
  
  -- Linear Measurements (feet)
  total_eave_length DECIMAL(10,2),
  total_rake_length DECIMAL(10,2),
  total_hip_length DECIMAL(10,2),
  total_valley_length DECIMAL(10,2),
  total_ridge_length DECIMAL(10,2),
  total_wall_flashing_length DECIMAL(10,2),
  total_step_flashing_length DECIMAL(10,2),
  total_unspecified_length DECIMAL(10,2),
  
  -- Materials
  material_calculations JSONB,
  
  -- Reports
  report_pdf_url TEXT,
  report_generated_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  notes TEXT,
  tags TEXT[],
  is_archived BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_roof_measurements_customer ON roof_measurements(customer_id);
CREATE INDEX IF NOT EXISTS idx_roof_measurements_address ON roof_measurements(property_address);
CREATE INDEX IF NOT EXISTS idx_roof_measurements_created ON roof_measurements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_roof_measurements_confidence ON roof_measurements(measurement_confidence);
CREATE INDEX IF NOT EXISTS idx_roof_measurements_measured_by ON roof_measurements(measured_by);

-- 2. ROOF FACETS (Individual roof planes)
CREATE TABLE IF NOT EXISTS roof_measurement_facets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  measurement_id UUID NOT NULL REFERENCES roof_measurements(id) ON DELETE CASCADE,
  facet_number INTEGER NOT NULL,
  
  polygon_points JSONB NOT NULL,
  centroid JSONB,
  shape_type TEXT CHECK (shape_type IN ('rectangle', 'triangle', 'trapezoid', 'pentagon', 'hexagon', 'irregular')),
  
  area_flat_sqft DECIMAL(10,2) NOT NULL,
  pitch TEXT NOT NULL,
  pitch_multiplier DECIMAL(5,3) NOT NULL,
  area_adjusted_sqft DECIMAL(10,2) NOT NULL,
  
  primary_direction TEXT,
  azimuth_degrees DECIMAL(5,2),
  
  eave_length DECIMAL(10,2) DEFAULT 0,
  rake_length DECIMAL(10,2) DEFAULT 0,
  hip_length DECIMAL(10,2) DEFAULT 0,
  valley_length DECIMAL(10,2) DEFAULT 0,
  ridge_length DECIMAL(10,2) DEFAULT 0,
  wall_flashing_length DECIMAL(10,2) DEFAULT 0,
  step_flashing_length DECIMAL(10,2) DEFAULT 0,
  
  has_chimney BOOLEAN DEFAULT false,
  chimney_count INTEGER DEFAULT 0,
  has_skylight BOOLEAN DEFAULT false,
  skylight_count INTEGER DEFAULT 0,
  vent_count INTEGER DEFAULT 0,
  penetration_count INTEGER DEFAULT 0,
  
  detection_confidence DECIMAL(5,2),
  adjacent_facet_ids UUID[],
  
  UNIQUE(measurement_id, facet_number)
);

CREATE INDEX IF NOT EXISTS idx_roof_measurement_facets_measurement ON roof_measurement_facets(measurement_id);

-- 3. MEASUREMENT CORRECTIONS (Training data)
CREATE TABLE IF NOT EXISTS roof_measurement_corrections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  measurement_id UUID NOT NULL REFERENCES roof_measurements(id) ON DELETE CASCADE,
  facet_id UUID REFERENCES roof_measurement_facets(id) ON DELETE CASCADE,
  corrected_by UUID REFERENCES auth.users(id),
  
  correction_type TEXT NOT NULL CHECK (correction_type IN (
    'total_area_adjustment',
    'facet_count_adjustment',
    'facet_area_adjustment',
    'pitch_adjustment',
    'linear_measurement_adjustment',
    'edge_classification_change',
    'feature_detection_correction'
  )),
  
  field_name TEXT NOT NULL,
  original_value JSONB NOT NULL,
  corrected_value JSONB NOT NULL,
  
  correction_reason TEXT,
  correction_notes TEXT,
  correction_method TEXT,
  
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  
  tags TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_roof_corrections_measurement ON roof_measurement_corrections(measurement_id);
CREATE INDEX IF NOT EXISTS idx_roof_corrections_type ON roof_measurement_corrections(correction_type);
CREATE INDEX IF NOT EXISTS idx_roof_corrections_created ON roof_measurement_corrections(created_at DESC);

-- 4. AI MODEL PERFORMANCE (Analytics)
CREATE TABLE IF NOT EXISTS roof_ai_model_performance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  logged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  measurement_id UUID NOT NULL REFERENCES roof_measurements(id) ON DELETE CASCADE,
  
  ai_predicted_area_sqft DECIMAL(10,2),
  ai_predicted_squares DECIMAL(10,2),
  ai_predicted_facet_count INTEGER,
  ai_predicted_pitch TEXT,
  
  final_area_sqft DECIMAL(10,2),
  final_squares DECIMAL(10,2),
  final_facet_count INTEGER,
  final_pitch TEXT,
  
  area_accuracy_percent DECIMAL(5,2),
  facet_accuracy_percent DECIMAL(5,2),
  pitch_accuracy BOOLEAN,
  linear_accuracy_percent DECIMAL(5,2),
  
  image_quality_score INTEGER CHECK (image_quality_score BETWEEN 1 AND 10),
  roof_complexity TEXT CHECK (roof_complexity IN ('simple', 'moderate', 'complex', 'very_complex')),
  property_type TEXT,
  geographic_region TEXT,
  
  processing_time_seconds DECIMAL(8,2),
  api_calls_made INTEGER,
  total_cost_usd DECIMAL(10,4),
  
  user_satisfaction_rating INTEGER CHECK (user_satisfaction_rating BETWEEN 1 AND 5),
  required_manual_corrections BOOLEAN DEFAULT false,
  correction_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_roof_performance_logged ON roof_ai_model_performance(logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_roof_performance_accuracy ON roof_ai_model_performance(area_accuracy_percent);
CREATE INDEX IF NOT EXISTS idx_roof_performance_measurement ON roof_ai_model_performance(measurement_id);

-- 5. MEASUREMENT VALIDATION TESTS (QA)
CREATE TABLE IF NOT EXISTS roof_measurement_validation_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  test_name TEXT NOT NULL,
  test_address TEXT NOT NULL,
  expected_results JSONB NOT NULL,
  
  measurement_id UUID REFERENCES roof_measurements(id),
  executed_at TIMESTAMP WITH TIME ZONE,
  executed_by UUID REFERENCES auth.users(id),
  
  actual_results JSONB,
  variance_metrics JSONB,
  overall_accuracy_score DECIMAL(5,2),
  test_status TEXT CHECK (test_status IN ('pending', 'passed', 'failed', 'needs_review')),
  
  passed_metrics TEXT[],
  failed_metrics TEXT[],
  warnings TEXT[],
  
  test_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_roof_validation_tests_status ON roof_measurement_validation_tests(test_status);
CREATE INDEX IF NOT EXISTS idx_roof_validation_tests_created ON roof_measurement_validation_tests(created_at DESC);

-- 6. IMAGE CACHE (Performance optimization)
CREATE TABLE IF NOT EXISTS roof_image_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  gps_coordinates JSONB NOT NULL,
  address_hash TEXT NOT NULL,
  
  image_source TEXT NOT NULL CHECK (image_source IN ('google_maps', 'mapbox', 'google_solar')),
  image_url TEXT,
  image_data BYTEA,
  zoom_level INTEGER,
  image_size TEXT,
  
  captured_date DATE,
  image_quality_score INTEGER CHECK (image_quality_score BETWEEN 1 AND 10),
  
  access_count INTEGER DEFAULT 0,
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '90 days'),
  
  UNIQUE(address_hash, image_source, zoom_level)
);

CREATE INDEX IF NOT EXISTS idx_roof_image_cache_hash ON roof_image_cache(address_hash);
CREATE INDEX IF NOT EXISTS idx_roof_image_cache_expires ON roof_image_cache(expires_at);

-- 7. PITCH MULTIPLIERS (Reference data)
CREATE TABLE IF NOT EXISTS roof_pitch_multipliers (
  pitch TEXT PRIMARY KEY,
  rise INTEGER NOT NULL,
  run INTEGER DEFAULT 12,
  multiplier DECIMAL(6,4) NOT NULL,
  degrees DECIMAL(5,2) NOT NULL,
  typical_regions TEXT[]
);

INSERT INTO roof_pitch_multipliers (pitch, rise, multiplier, degrees, typical_regions) VALUES
('1/12', 1, 1.0035, 4.76, ARRAY['Florida', 'Commercial Flat']),
('2/12', 2, 1.0138, 9.46, ARRAY['Low Slope', 'Modern Design']),
('3/12', 3, 1.0308, 14.04, ARRAY['Southwest', 'Mediterranean']),
('4/12', 4, 1.0541, 18.43, ARRAY['Southeast', 'Ranch Style']),
('5/12', 5, 1.0833, 22.62, ARRAY['Southeast', 'Traditional']),
('6/12', 6, 1.1180, 26.57, ARRAY['Mid-Atlantic', 'Colonial']),
('7/12', 7, 1.1577, 30.26, ARRAY['Northeast', 'Cape Cod']),
('8/12', 8, 1.2019, 33.69, ARRAY['Northeast', 'Victorian']),
('9/12', 9, 1.2500, 36.87, ARRAY['Mountain', 'A-Frame']),
('10/12', 10, 1.3017, 39.81, ARRAY['Snow Country', 'Chalet']),
('11/12', 11, 1.3566, 42.51, ARRAY['Heavy Snow', 'Alpine']),
('12/12', 12, 1.4142, 45.00, ARRAY['Extreme Snow', 'A-Frame'])
ON CONFLICT (pitch) DO NOTHING;

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW roof_measurement_summary AS
SELECT 
  rm.id,
  rm.property_address,
  rm.created_at,
  rm.total_area_adjusted_sqft,
  rm.total_squares,
  rm.facet_count,
  rm.predominant_pitch,
  rm.measurement_confidence,
  rm.validation_status,
  amp.area_accuracy_percent,
  amp.user_satisfaction_rating,
  COUNT(mc.id) as correction_count
FROM roof_measurements rm
LEFT JOIN roof_ai_model_performance amp ON rm.id = amp.measurement_id
LEFT JOIN roof_measurement_corrections mc ON rm.id = mc.measurement_id
GROUP BY rm.id, amp.area_accuracy_percent, amp.user_satisfaction_rating;

CREATE OR REPLACE VIEW roof_daily_performance_metrics AS
SELECT 
  DATE(logged_at) as date,
  COUNT(*) as total_measurements,
  AVG(area_accuracy_percent) as avg_accuracy,
  AVG(processing_time_seconds) as avg_processing_time,
  SUM(total_cost_usd) as total_cost,
  COUNT(CASE WHEN required_manual_corrections THEN 1 END) as corrections_needed
FROM roof_ai_model_performance
GROUP BY DATE(logged_at)
ORDER BY date DESC;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION update_roof_measurement_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION calculate_roof_squares_with_waste()
RETURNS TRIGGER AS $$
BEGIN
  NEW.total_squares_with_waste = NEW.total_squares * (1 + (NEW.waste_factor_percent / 100));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_roof_measurements_timestamp ON roof_measurements;
CREATE TRIGGER update_roof_measurements_timestamp
  BEFORE UPDATE ON roof_measurements
  FOR EACH ROW
  EXECUTE FUNCTION update_roof_measurement_timestamp();

DROP TRIGGER IF EXISTS calculate_roof_squares_with_waste ON roof_measurements;
CREATE TRIGGER calculate_roof_squares_with_waste
  BEFORE INSERT OR UPDATE ON roof_measurements
  FOR EACH ROW
  EXECUTE FUNCTION calculate_roof_squares_with_waste();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE roof_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_measurement_facets ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_measurement_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_ai_model_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_measurement_validation_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE roof_image_cache ENABLE ROW LEVEL SECURITY;

-- Roof Measurements policies
CREATE POLICY "Users can view own measurements"
  ON roof_measurements FOR SELECT
  USING (auth.uid() = measured_by OR measured_by IS NULL);

CREATE POLICY "Users can insert measurements"
  ON roof_measurements FOR INSERT
  WITH CHECK (auth.uid() = measured_by OR measured_by IS NULL);

CREATE POLICY "Users can update own measurements"
  ON roof_measurements FOR UPDATE
  USING (auth.uid() = measured_by OR measured_by IS NULL);

CREATE POLICY "Users can delete own measurements"
  ON roof_measurements FOR DELETE
  USING (auth.uid() = measured_by OR measured_by IS NULL);

-- Facets follow measurement permissions
CREATE POLICY "Facets follow measurement permissions"
  ON roof_measurement_facets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM roof_measurements
      WHERE roof_measurements.id = roof_measurement_facets.measurement_id
      AND (roof_measurements.measured_by = auth.uid() OR roof_measurements.measured_by IS NULL)
    )
  );

-- Corrections follow measurement permissions
CREATE POLICY "Corrections follow measurement permissions"
  ON roof_measurement_corrections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM roof_measurements
      WHERE roof_measurements.id = roof_measurement_corrections.measurement_id
      AND (roof_measurements.measured_by = auth.uid() OR roof_measurements.measured_by IS NULL)
    )
  );

-- Performance metrics follow measurement permissions
CREATE POLICY "Performance metrics follow measurement permissions"
  ON roof_ai_model_performance FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM roof_measurements
      WHERE roof_measurements.id = roof_ai_model_performance.measurement_id
      AND (roof_measurements.measured_by = auth.uid() OR roof_measurements.measured_by IS NULL)
    )
  );

-- Validation tests - authenticated users can manage
CREATE POLICY "Authenticated users can manage validation tests"
  ON roof_measurement_validation_tests FOR ALL
  USING (auth.role() = 'authenticated');

-- Image cache - authenticated users can access
CREATE POLICY "Authenticated users can access image cache"
  ON roof_image_cache FOR ALL
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- STORAGE BUCKET
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('roof-reports', 'roof-reports', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can view roof reports"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'roof-reports');

CREATE POLICY "Authenticated users can upload roof reports"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'roof-reports' AND auth.role() = 'authenticated');

CREATE POLICY "Users can delete own roof reports"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'roof-reports' AND auth.uid()::text = (storage.foldername(name))[1]);
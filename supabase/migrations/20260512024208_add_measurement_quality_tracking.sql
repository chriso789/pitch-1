-- ============================================================================
-- MEASUREMENT QUALITY TRACKING SCHEMA
-- Adds quality indicators, fallback tracking, and debug artifact storage
-- ============================================================================

-- ============================================================================
-- ADD QUALITY COLUMNS TO ROOF_MEASUREMENTS
-- ============================================================================

-- Add footprint source tracking
ALTER TABLE public.roof_measurements
ADD COLUMN IF NOT EXISTS footprint_source TEXT CHECK (
  footprint_source IN (
    'mapbox_vector',
    'microsoft_buildings',
    'osm',
    'google_solar_bbox',
    'user_traced',
    'vendor_report',
    'unknown'
  )
);

-- Add pitch source tracking
ALTER TABLE public.roof_measurements
ADD COLUMN IF NOT EXISTS pitch_source TEXT CHECK (
  pitch_source IN ('vendor', 'dsm', 'assumed', 'user_input', 'solar_api', 'unknown')
);

-- Add fallback flags (tracks which fallbacks were used)
ALTER TABLE public.roof_measurements
ADD COLUMN IF NOT EXISTS fallback_flags JSONB DEFAULT '[]'::jsonb;

-- Add quality warnings array
ALTER TABLE public.roof_measurements
ADD COLUMN IF NOT EXISTS quality_warnings JSONB DEFAULT '[]'::jsonb;

-- Add reliability flag
ALTER TABLE public.roof_measurements
ADD COLUMN IF NOT EXISTS is_reliable BOOLEAN DEFAULT true;

-- Add analysis parameters for overlay alignment
ALTER TABLE public.roof_measurements
ADD COLUMN IF NOT EXISTS analysis_zoom INTEGER DEFAULT 20;

ALTER TABLE public.roof_measurements
ADD COLUMN IF NOT EXISTS analysis_image_size JSONB DEFAULT '{"width": 640, "height": 640}'::jsonb;

-- Add geometry validation status
ALTER TABLE public.roof_measurements
ADD COLUMN IF NOT EXISTS geometry_validated BOOLEAN DEFAULT false;

ALTER TABLE public.roof_measurements
ADD COLUMN IF NOT EXISTS geometry_validation_errors JSONB DEFAULT '[]'::jsonb;

-- ============================================================================
-- MEASUREMENT QA RESULTS TABLE
-- Stores geometry validation gate results
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.measurement_qa_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES public.roof_measurements(id) ON DELETE CASCADE,

  -- Overall validation result
  is_valid BOOLEAN NOT NULL,
  confidence_score DECIMAL(5,2),

  -- Individual check results
  footprint_valid BOOLEAN,
  footprint_vertex_count INTEGER,
  footprint_errors JSONB DEFAULT '[]'::jsonb,

  area_valid BOOLEAN,
  area_sqft DECIMAL(10,2),
  area_error_pct DECIMAL(5,2),
  area_errors JSONB DEFAULT '[]'::jsonb,

  perimeter_valid BOOLEAN,
  perimeter_ft DECIMAL(10,2),
  perimeter_errors JSONB DEFAULT '[]'::jsonb,

  linear_features_valid BOOLEAN,
  linear_feature_count INTEGER,
  linear_errors JSONB DEFAULT '[]'::jsonb,

  topology_valid BOOLEAN,
  topology_errors JSONB DEFAULT '[]'::jsonb,

  -- All errors and warnings combined
  all_errors JSONB DEFAULT '[]'::jsonb,
  all_warnings JSONB DEFAULT '[]'::jsonb,

  -- Metadata
  validated_at TIMESTAMPTZ DEFAULT NOW(),
  validator_version TEXT DEFAULT '1.0',

  UNIQUE(measurement_id)
);

CREATE INDEX IF NOT EXISTS idx_qa_results_measurement
ON public.measurement_qa_results(measurement_id);

CREATE INDEX IF NOT EXISTS idx_qa_results_valid
ON public.measurement_qa_results(is_valid);

-- ============================================================================
-- MEASUREMENT DEBUG ARTIFACTS TABLE
-- Stores debug snapshots for failed or problematic measurements
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.measurement_debug_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES public.roof_measurements(id) ON DELETE CASCADE,

  -- Artifact type
  artifact_type TEXT NOT NULL CHECK (
    artifact_type IN (
      'footprint_candidates',
      'skeleton_output',
      'dsm_data',
      'vision_analysis',
      'linear_features_raw',
      'coordinate_transform',
      'error_snapshot',
      'validation_details'
    )
  ),

  -- Artifact data
  data JSONB NOT NULL,

  -- Optional binary data (base64 encoded)
  binary_data TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),

  -- Optional tags for filtering
  tags TEXT[] DEFAULT ARRAY[]::TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_debug_artifacts_measurement
ON public.measurement_debug_artifacts(measurement_id);

CREATE INDEX IF NOT EXISTS idx_debug_artifacts_type
ON public.measurement_debug_artifacts(artifact_type);

CREATE INDEX IF NOT EXISTS idx_debug_artifacts_created
ON public.measurement_debug_artifacts(created_at DESC);

-- Auto-cleanup expired artifacts
CREATE INDEX IF NOT EXISTS idx_debug_artifacts_expires
ON public.measurement_debug_artifacts(expires_at);

-- ============================================================================
-- FOOTPRINT CANDIDATES TABLE
-- Stores all footprint options considered during measurement
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.measurement_footprint_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID REFERENCES public.roof_measurements(id) ON DELETE CASCADE,

  source TEXT NOT NULL CHECK (
    source IN (
      'mapbox_vector',
      'microsoft_buildings',
      'osm',
      'google_solar_bbox',
      'user_traced',
      'vendor_report'
    )
  ),

  -- Geometry
  vertex_count INTEGER,
  area_sqft DECIMAL(10,2),
  perimeter_ft DECIMAL(10,2),
  polygon_wkt TEXT,

  -- Quality metrics
  confidence DECIMAL(5,2),
  was_selected BOOLEAN DEFAULT false,
  rejection_reason TEXT,

  -- Metadata
  fetch_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_footprint_candidates_measurement
ON public.measurement_footprint_candidates(measurement_id);

CREATE INDEX IF NOT EXISTS idx_footprint_candidates_selected
ON public.measurement_footprint_candidates(was_selected);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.measurement_qa_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_debug_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurement_footprint_candidates ENABLE ROW LEVEL SECURITY;

-- QA Results follow measurement permissions
DROP POLICY IF EXISTS "QA results follow measurement permissions" ON public.measurement_qa_results;
CREATE POLICY "QA results follow measurement permissions"
ON public.measurement_qa_results FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements
    WHERE roof_measurements.id = measurement_qa_results.measurement_id
    AND (roof_measurements.measured_by = auth.uid() OR roof_measurements.measured_by IS NULL)
  )
);

-- Debug artifacts follow measurement permissions
DROP POLICY IF EXISTS "Debug artifacts follow measurement permissions" ON public.measurement_debug_artifacts;
CREATE POLICY "Debug artifacts follow measurement permissions"
ON public.measurement_debug_artifacts FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements
    WHERE roof_measurements.id = measurement_debug_artifacts.measurement_id
    AND (roof_measurements.measured_by = auth.uid() OR roof_measurements.measured_by IS NULL)
  )
);

-- Footprint candidates follow measurement permissions
DROP POLICY IF EXISTS "Footprint candidates follow measurement permissions" ON public.measurement_footprint_candidates;
CREATE POLICY "Footprint candidates follow measurement permissions"
ON public.measurement_footprint_candidates FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements
    WHERE roof_measurements.id = measurement_footprint_candidates.measurement_id
    AND (roof_measurements.measured_by = auth.uid() OR roof_measurements.measured_by IS NULL)
  )
);

-- ============================================================================
-- CLEANUP FUNCTION FOR EXPIRED DEBUG ARTIFACTS
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_debug_artifacts()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.measurement_debug_artifacts
  WHERE expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- VIEW FOR MEASUREMENT QUALITY OVERVIEW
-- ============================================================================

CREATE OR REPLACE VIEW public.measurement_quality_overview AS
SELECT
  rm.id,
  rm.property_address,
  rm.created_at,
  rm.footprint_source,
  rm.pitch_source,
  rm.is_reliable,
  rm.geometry_validated,
  rm.measurement_confidence,
  rm.validation_status,
  qa.is_valid as qa_valid,
  qa.confidence_score as qa_confidence,
  jsonb_array_length(COALESCE(rm.quality_warnings, '[]'::jsonb)) as warning_count,
  jsonb_array_length(COALESCE(rm.fallback_flags, '[]'::jsonb)) as fallback_count,
  jsonb_array_length(COALESCE(qa.all_errors, '[]'::jsonb)) as error_count
FROM public.roof_measurements rm
LEFT JOIN public.measurement_qa_results qa ON rm.id = qa.measurement_id;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT SELECT ON public.measurement_quality_overview TO authenticated;

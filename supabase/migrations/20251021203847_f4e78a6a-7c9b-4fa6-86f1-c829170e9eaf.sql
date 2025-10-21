-- ============================================================
-- Pull Measurements System - Database Schema
-- Production-ready measurement system with PostGIS, versioning, and Smart Tags
-- ============================================================

-- 1) Enable PostGIS for accurate worldwide geographic calculations
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- 2) Create measurements table with versioning and geography support
CREATE TABLE IF NOT EXISTS measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL, -- references pipeline_entries(id)
  source TEXT NOT NULL, -- 'regrid', 'osm', 'manual', 'eagleview', 'nearmap', 'hover', 'google_solar'
  faces JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of RoofFace objects
  linear_features JSONB DEFAULT '[]'::jsonb, -- array of LinearFeature objects
  summary JSONB NOT NULL, -- { total_area_sqft, total_squares, waste_pct, pitch_method }
  geom_geog GEOGRAPHY(MULTIPOLYGON, 4326), -- accurate worldwide area calculation
  version INT NOT NULL DEFAULT 1,
  supersedes UUID REFERENCES measurements(id), -- previous version
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurements_property ON measurements(property_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurements_active ON measurements(property_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurements_geog ON measurements USING GIST (geom_geog);

-- 3) Create measure_jobs table for async provider tracking
CREATE TABLE IF NOT EXISTS measure_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('eagleview', 'nearmap', 'hover', 'roofr')),
  external_ref TEXT, -- vendor's job/order ID
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'canceled')),
  measurement_id UUID REFERENCES measurements(id),
  error TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measure_jobs_property ON measure_jobs(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_measure_jobs_status ON measure_jobs(status, created_at DESC);

-- 4) Create measurement_tags table for materialized Smart Tags
CREATE TABLE IF NOT EXISTS measurement_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  measurement_id UUID NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
  property_id UUID NOT NULL,
  tags JSONB NOT NULL, -- { "roof.squares": 25.5, "lf.ridge": 48, "bundles.shingles": 77, ... }
  version INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_measurement_tags_property ON measurement_tags(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurement_tags_measurement ON measurement_tags(measurement_id);
CREATE INDEX IF NOT EXISTS idx_measurement_tags_jsonb ON measurement_tags USING GIN (tags jsonb_path_ops);

-- 5) Add measurement link to estimates table (optional, for direct reference)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'estimates' AND column_name = 'measurement_id'
  ) THEN
    ALTER TABLE estimates ADD COLUMN measurement_id UUID REFERENCES measurements(id);
  END IF;
END $$;

-- 6) RLS Policies - match existing pattern from pipeline_entries
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE measure_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE measurement_tags ENABLE ROW LEVEL SECURITY;

-- measurements policies
CREATE POLICY "Users can view measurements in their tenant"
  ON measurements FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM pipeline_entries WHERE tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "Users can create measurements in their tenant"
  ON measurements FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM pipeline_entries WHERE tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "Users can update measurements in their tenant"
  ON measurements FOR UPDATE
  USING (
    property_id IN (
      SELECT id FROM pipeline_entries WHERE tenant_id = get_user_tenant_id()
    )
  );

-- measure_jobs policies
CREATE POLICY "Users can view jobs in their tenant"
  ON measure_jobs FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM pipeline_entries WHERE tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "Users can create jobs in their tenant"
  ON measure_jobs FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM pipeline_entries WHERE tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "Users can update jobs in their tenant"
  ON measure_jobs FOR UPDATE
  USING (
    property_id IN (
      SELECT id FROM pipeline_entries WHERE tenant_id = get_user_tenant_id()
    )
  );

-- measurement_tags policies
CREATE POLICY "Users can view tags in their tenant"
  ON measurement_tags FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM pipeline_entries WHERE tenant_id = get_user_tenant_id()
    )
  );

CREATE POLICY "Users can create tags in their tenant"
  ON measurement_tags FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM pipeline_entries WHERE tenant_id = get_user_tenant_id()
    )
  );

-- 7) Helper function for inserting measurements with WKT geometry
CREATE OR REPLACE FUNCTION insert_measurement(
  p_property_id UUID,
  p_source TEXT,
  p_faces JSONB,
  p_summary JSONB,
  p_created_by UUID,
  p_geom_wkt TEXT,
  p_linear_features JSONB DEFAULT '[]'::jsonb
) RETURNS measurements AS $$
DECLARE 
  v_new_row measurements;
BEGIN
  INSERT INTO measurements(
    property_id, 
    source, 
    faces, 
    linear_features,
    summary, 
    created_by, 
    geom_geog
  )
  VALUES (
    p_property_id, 
    p_source, 
    p_faces,
    p_linear_features,
    p_summary, 
    p_created_by,
    CASE 
      WHEN p_geom_wkt IS NULL THEN NULL 
      ELSE ST_GeogFromText(p_geom_wkt) 
    END
  )
  RETURNING * INTO v_new_row;

  RETURN v_new_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
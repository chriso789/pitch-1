-- Add footprint source tracking to roof_measurements
ALTER TABLE roof_measurements
ADD COLUMN IF NOT EXISTS footprint_source TEXT CHECK (footprint_source IN ('google_solar_api', 'regrid_parcel', 'ai_detection', 'manual')),
ADD COLUMN IF NOT EXISTS footprint_confidence NUMERIC(4,3),
ADD COLUMN IF NOT EXISTS footprint_requires_review BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS footprint_vertices_geo JSONB,
ADD COLUMN IF NOT EXISTS footprint_validation JSONB;

COMMENT ON COLUMN roof_measurements.footprint_source IS 'Source of building footprint: google_solar_api (best), regrid_parcel (good), ai_detection (fallback), manual (user traced)';
COMMENT ON COLUMN roof_measurements.footprint_confidence IS 'Confidence score 0.0-1.0 based on source and validation';
COMMENT ON COLUMN roof_measurements.footprint_requires_review IS 'Whether the footprint requires manual verification';
COMMENT ON COLUMN roof_measurements.footprint_vertices_geo IS 'GeoJSON vertices of the building footprint in lat/lng';
COMMENT ON COLUMN roof_measurements.footprint_validation IS 'Validation results including area, perimeter, errors, and warnings';
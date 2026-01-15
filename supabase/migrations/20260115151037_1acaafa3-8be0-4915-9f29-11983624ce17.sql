-- Phase 5: Add accuracy tracking columns to roof_measurements table
-- These columns track measurement accuracy against manual references

-- Add manual reference area for comparison
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS manual_reference_area_sqft NUMERIC;

-- Add calculated accuracy percentage (positive = overestimate, negative = underestimate)
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS accuracy_vs_manual_percent NUMERIC;

-- Add footprint vertex count for complexity tracking
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS footprint_vertex_count INTEGER;

-- Add flag for rectangular footprints (simple 4-vertex bbox)
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS footprint_is_rectangular BOOLEAN DEFAULT false;

-- Add flag for measurements requiring manual review
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS requires_manual_review BOOLEAN DEFAULT false;

-- Add footprint source tracking (mapbox_vector, osm_buildings, microsoft_buildings, solar_bbox_fallback, etc.)
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS footprint_source TEXT;

-- Add edge coverage percentage (eave+rake / perimeter)
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS edge_coverage_percent NUMERIC;

-- Add quality score (0-100) based on multiple factors
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS quality_score INTEGER;

-- Add manual footprint override WKT
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS manual_perimeter_wkt TEXT;

-- Add timestamp for when accuracy was last compared
ALTER TABLE roof_measurements ADD COLUMN IF NOT EXISTS accuracy_compared_at TIMESTAMPTZ;

-- Create index for finding measurements that need review
CREATE INDEX IF NOT EXISTS idx_roof_measurements_requires_review 
ON roof_measurements(requires_manual_review) 
WHERE requires_manual_review = true;

-- Create index for footprint source analysis
CREATE INDEX IF NOT EXISTS idx_roof_measurements_footprint_source 
ON roof_measurements(footprint_source);

-- Comment on columns for documentation
COMMENT ON COLUMN roof_measurements.manual_reference_area_sqft IS 'User-provided manual measurement area for accuracy comparison';
COMMENT ON COLUMN roof_measurements.accuracy_vs_manual_percent IS 'Percentage difference from manual reference (positive = AI overestimated)';
COMMENT ON COLUMN roof_measurements.footprint_vertex_count IS 'Number of vertices in the footprint polygon';
COMMENT ON COLUMN roof_measurements.footprint_is_rectangular IS 'True if footprint is a simple 4-vertex rectangle (likely bbox fallback)';
COMMENT ON COLUMN roof_measurements.requires_manual_review IS 'True if measurement needs human verification';
COMMENT ON COLUMN roof_measurements.footprint_source IS 'Source of footprint data (mapbox_vector, osm_buildings, microsoft_buildings, solar_bbox_fallback, etc.)';
COMMENT ON COLUMN roof_measurements.edge_coverage_percent IS 'Percentage of perimeter covered by eave+rake linear features';
COMMENT ON COLUMN roof_measurements.quality_score IS 'Overall quality score 0-100 based on confidence, coverage, and source';
COMMENT ON COLUMN roof_measurements.manual_perimeter_wkt IS 'User-provided manual footprint override in WKT format';
COMMENT ON COLUMN roof_measurements.accuracy_compared_at IS 'Timestamp when accuracy was last compared to manual reference';
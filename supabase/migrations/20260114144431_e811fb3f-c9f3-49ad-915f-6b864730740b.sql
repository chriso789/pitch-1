-- Add columns to track footprint detection source and imagery quality
-- These columns help identify which measurements need manual review

-- Add detection_method column (tracks source: google_solar_api, regrid_parcel, ai_detection, mapbox_vector)
ALTER TABLE roof_measurements
ADD COLUMN IF NOT EXISTS detection_method VARCHAR(50) DEFAULT 'ai_detection';

-- Add imagery_date column (when the satellite imagery was captured)
ALTER TABLE roof_measurements
ADD COLUMN IF NOT EXISTS imagery_date DATE;

-- Add imagery_quality column (quality rating from Solar API or other sources)
ALTER TABLE roof_measurements
ADD COLUMN IF NOT EXISTS imagery_quality VARCHAR(20);

-- Add comments for documentation
COMMENT ON COLUMN roof_measurements.detection_method IS 'Source of building footprint: google_solar_api, regrid_parcel, mapbox_vector, or ai_detection';
COMMENT ON COLUMN roof_measurements.imagery_date IS 'Date when the satellite imagery was captured';
COMMENT ON COLUMN roof_measurements.imagery_quality IS 'Quality rating from imagery source (HIGH, MEDIUM, LOW)';

-- Create index for filtering measurements by detection method
CREATE INDEX IF NOT EXISTS idx_roof_measurements_detection_method 
ON roof_measurements(detection_method);

-- Create index for filtering measurements that require review
CREATE INDEX IF NOT EXISTS idx_roof_measurements_requires_review 
ON roof_measurements(footprint_requires_review) 
WHERE footprint_requires_review = true;
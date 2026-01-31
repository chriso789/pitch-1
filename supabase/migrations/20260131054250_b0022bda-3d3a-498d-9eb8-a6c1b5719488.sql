-- Phase 8: Database Schema Updates for AI Roof Measurement Pipeline
-- Adds new columns to roof_measurements and creates storage buckets

-- Add new columns to roof_measurements table for enhanced data storage
ALTER TABLE roof_measurements 
ADD COLUMN IF NOT EXISTS facets_json JSONB,
ADD COLUMN IF NOT EXISTS satellite_overlay_url TEXT,
ADD COLUMN IF NOT EXISTS vector_diagram_svg TEXT,
ADD COLUMN IF NOT EXISTS measurement_method TEXT DEFAULT 'legacy',
ADD COLUMN IF NOT EXISTS segmentation_model TEXT,
ADD COLUMN IF NOT EXISTS preprocessing_applied JSONB,
ADD COLUMN IF NOT EXISTS segmentation_confidence DECIMAL(5,4),
ADD COLUMN IF NOT EXISTS facet_closure_score DECIMAL(5,4),
ADD COLUMN IF NOT EXISTS edge_continuity_score DECIMAL(5,4);

-- Add index for faster lookup by measurement method
CREATE INDEX IF NOT EXISTS idx_roof_measurements_method 
ON roof_measurements(measurement_method);

-- Create satellite-imagery bucket (private - for internal processing)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('satellite-imagery', 'satellite-imagery', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Create roof-overlays bucket (public - for diagram display)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('roof-overlays', 'roof-overlays', true, 10485760, ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- RLS policies for satellite-imagery (private, service role only)
CREATE POLICY "Service role can manage satellite-imagery"
ON storage.objects FOR ALL
USING (bucket_id = 'satellite-imagery')
WITH CHECK (bucket_id = 'satellite-imagery');

-- RLS policies for roof-overlays (public read, authenticated write)
CREATE POLICY "Anyone can view roof-overlays"
ON storage.objects FOR SELECT
USING (bucket_id = 'roof-overlays');

CREATE POLICY "Authenticated users can upload roof-overlays"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'roof-overlays' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update their roof-overlays"
ON storage.objects FOR UPDATE
USING (bucket_id = 'roof-overlays' AND auth.role() = 'authenticated');

-- Add comment describing new measurement methods
COMMENT ON COLUMN roof_measurements.measurement_method IS 'Method used: legacy, ai_segmentation, solar_api, manual';
COMMENT ON COLUMN roof_measurements.facets_json IS 'Per-facet polygon/area/pitch data from AI segmentation';
COMMENT ON COLUMN roof_measurements.satellite_overlay_url IS 'URL to annotated satellite image with detected roof overlay';
COMMENT ON COLUMN roof_measurements.vector_diagram_svg IS 'Inline SVG for clean vector roof diagram';
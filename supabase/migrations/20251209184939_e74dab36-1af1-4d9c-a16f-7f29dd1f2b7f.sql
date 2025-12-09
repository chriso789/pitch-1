-- Add missing columns for enhanced measurement analysis
ALTER TABLE roof_measurements 
ADD COLUMN IF NOT EXISTS analysis_image_size jsonb,
ADD COLUMN IF NOT EXISTS analysis_zoom integer,
ADD COLUMN IF NOT EXISTS bounding_box jsonb,
ADD COLUMN IF NOT EXISTS image_source text,
ADD COLUMN IF NOT EXISTS image_year integer,
ADD COLUMN IF NOT EXISTS quality_assessment jsonb;
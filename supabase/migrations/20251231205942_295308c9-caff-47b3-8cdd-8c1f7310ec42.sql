-- Add pdf_url and short_description columns to enhanced_estimates
ALTER TABLE enhanced_estimates 
ADD COLUMN IF NOT EXISTS pdf_url text,
ADD COLUMN IF NOT EXISTS short_description text;

-- Add comment for documentation
COMMENT ON COLUMN enhanced_estimates.pdf_url IS 'Storage path to the generated estimate PDF';
COMMENT ON COLUMN enhanced_estimates.short_description IS '2-word description like "GAF Premium" for quick identification';
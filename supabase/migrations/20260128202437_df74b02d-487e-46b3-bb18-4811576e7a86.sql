-- Add pricing_tier column to enhanced_estimates for Good/Better/Best categorization
ALTER TABLE enhanced_estimates 
ADD COLUMN IF NOT EXISTS pricing_tier TEXT;

-- Add check constraint to ensure valid values
ALTER TABLE enhanced_estimates 
ADD CONSTRAINT enhanced_estimates_pricing_tier_check 
CHECK (pricing_tier IS NULL OR pricing_tier IN ('good', 'better', 'best'));

-- Add comment for documentation
COMMENT ON COLUMN enhanced_estimates.pricing_tier IS 'Pricing tier classification: good, better, or best';
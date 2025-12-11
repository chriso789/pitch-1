-- Add brand/product columns to templates table
ALTER TABLE templates ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS product_line TEXT;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS roof_type TEXT;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS is_system_default BOOLEAN DEFAULT false;

-- Add SKU/manufacturer columns to template_items table
ALTER TABLE template_items ADD COLUMN IF NOT EXISTS sku_pattern TEXT;
ALTER TABLE template_items ADD COLUMN IF NOT EXISTS manufacturer TEXT;
ALTER TABLE template_items ADD COLUMN IF NOT EXISTS coverage_per_unit NUMERIC;

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_template_items_sku_pattern ON template_items(sku_pattern);
CREATE INDEX IF NOT EXISTS idx_templates_brand ON templates(brand);
CREATE INDEX IF NOT EXISTS idx_templates_roof_type ON templates(roof_type);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_tagline text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_headline text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_stats jsonb DEFAULT '[]'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_testimonial jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_commitments jsonb DEFAULT '[]'::jsonb;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_primary_color text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_accent_color text;
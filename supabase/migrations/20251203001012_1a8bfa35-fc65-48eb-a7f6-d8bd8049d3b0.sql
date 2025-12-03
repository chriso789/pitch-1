-- Add verified address columns to locations table
ALTER TABLE locations ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS place_id TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS formatted_address TEXT;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS verified_address JSONB;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS address_verified_at TIMESTAMPTZ;

-- Add index for geo lookups
CREATE INDEX IF NOT EXISTS idx_locations_coordinates ON locations(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
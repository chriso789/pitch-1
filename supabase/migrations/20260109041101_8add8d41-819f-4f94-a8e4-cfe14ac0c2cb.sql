-- Add logo_url column to locations table for location-specific branding
ALTER TABLE locations ADD COLUMN IF NOT EXISTS logo_url TEXT;
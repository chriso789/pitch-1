-- Add structured address validation columns to contacts table
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS address_components JSONB,
ADD COLUMN IF NOT EXISTS address_validated BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS address_validated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS google_place_id TEXT,
ADD COLUMN IF NOT EXISTS address_validation_score DECIMAL(5,2);

-- Add comment for documentation
COMMENT ON COLUMN public.contacts.address_components IS 'Structured address components from Google Address Validation API (street_number, route, city, state, etc.)';
COMMENT ON COLUMN public.contacts.address_validated IS 'Whether the address has been validated via Google Address Validation API';
COMMENT ON COLUMN public.contacts.address_validated_at IS 'Timestamp of when the address was last validated';
COMMENT ON COLUMN public.contacts.google_place_id IS 'Google Places ID for the validated address';
COMMENT ON COLUMN public.contacts.address_validation_score IS 'Confidence score from address validation (0-100)';
-- Add coordinates for Jared Janacek's lead to fix "Missing Location" error

-- Step 1: Ensure latitude/longitude columns exist in contacts table
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- Step 2: Update contact with geocoded coordinates for the Boca Raton address
-- Address: 2847 Northeast 2nd Avenue, Boca Raton, FL 33431
-- Coordinates: 26.3683064, -80.1289321
UPDATE contacts
SET 
  latitude = 26.3683064,
  longitude = -80.1289321
WHERE id = '1451a289-704c-42c5-9c1a-faeb0f38d917';

-- Step 3: Update pipeline_entry metadata with verified address information
UPDATE pipeline_entries
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{verified_address}',
  jsonb_build_object(
    'formatted_address', '2847 Northeast 2nd Avenue, Boca Raton, FL 33431, USA',
    'geometry', jsonb_build_object(
      'location', jsonb_build_object(
        'lat', 26.3683064,
        'lng', -80.1289321
      )
    ),
    'address_verified', true
  )
)
WHERE id = 'd3fe7223-5da1-44b9-8f7a-d10155ab83f9';
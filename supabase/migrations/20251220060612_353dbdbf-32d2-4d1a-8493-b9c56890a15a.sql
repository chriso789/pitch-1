-- Update East Coast location with 561 Boca Raton number
UPDATE locations 
SET 
  telnyx_phone_number = '+15613144201',
  phone_porting_status = 'active',
  phone_setup_metadata = jsonb_build_object(
    'setup_type', 'manual_assignment',
    'assigned_at', now()::text,
    'previous_number', '+19045859339',
    'locality', 'BOCA RATON',
    'area_code', '561'
  ),
  updated_at = now()
WHERE id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Update West Coast location with 941 Cape Haze number
UPDATE locations 
SET 
  telnyx_phone_number = '+19415410117',
  phone_porting_status = 'active',
  phone_setup_metadata = jsonb_build_object(
    'setup_type', 'manual_assignment',
    'assigned_at', now()::text,
    'previous_number', '+19046220117',
    'locality', 'CAPE HAZE',
    'area_code', '941'
  ),
  updated_at = now()
WHERE id = 'c490231c-2a0e-4afc-8412-672e1c890c16';
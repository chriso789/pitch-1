
DO $$
DECLARE
  new_contact_id uuid;
BEGIN
  -- 1. Create David Ramage contact
  INSERT INTO public.contacts (
    tenant_id,
    location_id,
    first_name,
    last_name,
    phone,
    address_street,
    address_city,
    address_state,
    address_zip,
    lead_source
  ) VALUES (
    '14de934e-7964-4afd-940a-620d2ace125d',
    'c490231c-2a0e-4afc-8412-672e1c890c16',
    'David',
    'Ramage',
    '111111111',
    '4171 101st Ave E',
    'Parrish',
    'FL',
    '34219',
    'manual'
  )
  RETURNING id INTO new_contact_id;

  -- 2. Repoint pipeline entry to new David Ramage contact
  UPDATE public.pipeline_entries
  SET contact_id = new_contact_id
  WHERE id = 'e9a27514-bc6f-4b42-9dd9-fa9d74c6a886';
END $$;

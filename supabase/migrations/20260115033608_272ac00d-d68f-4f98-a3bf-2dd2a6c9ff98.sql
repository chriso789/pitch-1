-- Move 277 contacts from West Coast to East Coast and assign to Michael Grosso
UPDATE contacts
SET 
  location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6',  -- East Coast
  assigned_to = 'f828ec8a-07e9-4d20-a642-a60cb320fede', -- Michael Grosso
  updated_at = NOW()
WHERE location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'  -- West Coast
  AND assigned_to = '9cb8216b-28e9-4ad6-a751-75ede6e81b35'  -- Chris Riegler
  AND updated_at > NOW() - INTERVAL '2 hours';

-- Update corresponding pipeline entries
UPDATE pipeline_entries
SET 
  location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6',  -- East Coast
  assigned_to = 'f828ec8a-07e9-4d20-a642-a60cb320fede', -- Michael Grosso
  updated_at = NOW()
WHERE location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'  -- West Coast
  AND assigned_to = '9cb8216b-28e9-4ad6-a751-75ede6e81b35'  -- Chris Riegler
  AND updated_at > NOW() - INTERVAL '2 hours';
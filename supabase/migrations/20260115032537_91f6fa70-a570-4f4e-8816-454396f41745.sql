-- Reassign Michael Grosso's West Coast contacts to Chris Riegler
UPDATE contacts
SET assigned_to = '9cb8216b-28e9-4ad6-a751-75ede6e81b35',
    updated_at = NOW()
WHERE location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
  AND assigned_to = 'f828ec8a-07e9-4d20-a642-a60cb320fede';

-- Also update their pipeline entries
UPDATE pipeline_entries
SET assigned_to = '9cb8216b-28e9-4ad6-a751-75ede6e81b35',
    updated_at = NOW()
WHERE location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
  AND assigned_to = 'f828ec8a-07e9-4d20-a642-a60cb320fede';
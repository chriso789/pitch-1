-- Rename "Estimates" to "Estimate Templates" in settings sidebar
UPDATE settings_tabs
SET 
  label = 'Estimate Templates',
  description = 'Create and manage calculation templates for generating estimates',
  updated_at = NOW()
WHERE tab_key = 'estimates';

-- Fix Don Brandt's pipeline entry - move to West Coast to match contact location
UPDATE pipeline_entries
SET 
  location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16',
  updated_at = NOW()
WHERE id = '330f04e6-c9dd-4c7b-96e1-a79968467a2a'
  AND location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';
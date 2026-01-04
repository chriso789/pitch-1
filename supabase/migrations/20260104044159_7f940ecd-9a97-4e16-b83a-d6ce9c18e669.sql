-- Create default location for Cox Roofing if none exists
INSERT INTO locations (tenant_id, name, is_primary, is_active)
SELECT 'c4d5ef66-ed66-4335-90ed-a96443b7cc43', 'Main Office', true, true
WHERE NOT EXISTS (
  SELECT 1 FROM locations WHERE tenant_id = 'c4d5ef66-ed66-4335-90ed-a96443b7cc43'
);

-- Update existing contact to use the new location
UPDATE contacts 
SET location_id = (
  SELECT id FROM locations 
  WHERE tenant_id = 'c4d5ef66-ed66-4335-90ed-a96443b7cc43' 
  LIMIT 1
)
WHERE id = 'eec08ba3-ce8d-4c09-bd74-5f2961a771e7' 
  AND location_id IS NULL;

-- Update pipeline entry to use the location
UPDATE pipeline_entries 
SET location_id = (
  SELECT id FROM locations 
  WHERE tenant_id = 'c4d5ef66-ed66-4335-90ed-a96443b7cc43' 
  LIMIT 1
)
WHERE id = '24c95aef-51ff-4123-8dcc-eb7a6c84745e'
  AND location_id IS NULL;
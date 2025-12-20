-- Delete duplicate West Coast entry
DELETE FROM locations WHERE id = 'dc72e26e-a364-4a33-abd7-ff9d0bc04426';

-- Clear broken phone numbers (use valid status value)
UPDATE locations 
SET telnyx_phone_number = NULL, phone_porting_status = NULL
WHERE id IN (
  'a3615f0d-c7b7-4ee9-a568-a71508a539c6',
  'c490231c-2a0e-4afc-8412-672e1c890c16'
);

-- Set East Coast as primary
UPDATE locations 
SET is_primary = true 
WHERE id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';
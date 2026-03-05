
-- Step 1: Re-link the duplicate's pipeline entry to the original contact
UPDATE pipeline_entries 
SET contact_id = '27e41e33-f7fa-484b-865d-149bb27e0402'
WHERE id = '3f20dcd4-90f9-4e69-ad25-3932ceaf77e3'
  AND contact_id = 'eee5494d-2cb6-4c17-a988-4cc3139c820d';

-- Step 2: Delete the duplicate contact FIRST
DELETE FROM contacts 
WHERE id = 'eee5494d-2cb6-4c17-a988-4cc3139c820d';

-- Step 3: Now fix the original contact's address fields
UPDATE contacts 
SET address_street = '512 Park Avenue',
    address_city = 'West Palm Beach',
    address_state = 'FL',
    address_zip = '33403'
WHERE id = '27e41e33-f7fa-484b-865d-149bb27e0402';

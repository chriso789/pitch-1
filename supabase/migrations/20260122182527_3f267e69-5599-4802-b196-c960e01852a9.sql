-- Delete duplicate Jean Louis contacts and their pipeline entries
-- Keeping Contact #3111 (adf03d46-...) as the primary record

-- Step 1: Delete pipeline entries for duplicate contacts first (foreign key constraint)
DELETE FROM pipeline_entries 
WHERE id IN (
  'a0f166f0-bfe5-42a5-87bd-2b3662316a72',  -- Contact 3112's pipeline entry
  'd6f44a3f-0340-45f9-8a19-9da96c0bf72e'   -- Contact 3294's pipeline entry
);

-- Step 2: Delete the duplicate contact records
DELETE FROM contacts 
WHERE id IN (
  '865cc577-41ee-4f2d-97cf-0bc94beb8a4c',  -- Contact 3112
  'e3346a70-4a95-4eb9-aa6b-2c1dbcf0872b'   -- Contact 3294
);
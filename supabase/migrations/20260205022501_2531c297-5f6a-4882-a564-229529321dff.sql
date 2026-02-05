-- Step 1: Move all documents from duplicate "East Coast " to canonical "East Coast"
UPDATE documents 
SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Step 2: Move all pipeline_entries from duplicate to canonical
UPDATE pipeline_entries 
SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Step 3: Move all contacts from duplicate to canonical
UPDATE contacts 
SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Step 4: Move all projects from duplicate to canonical
UPDATE projects 
SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Step 5: Move any user_location_assignments from duplicate to canonical
UPDATE user_location_assignments 
SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Step 6: Move any estimates from duplicate to canonical
UPDATE estimates 
SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Step 7: Move any ai_agents from duplicate to canonical
UPDATE ai_agents 
SET location_id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af'
WHERE location_id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Step 8: Delete the duplicate "East Coast " location (with trailing space)
DELETE FROM locations 
WHERE id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';
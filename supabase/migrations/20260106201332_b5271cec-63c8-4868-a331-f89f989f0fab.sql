-- Fix Edward Lake's pipeline entries location to West Coast
UPDATE pipeline_entries 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id IN ('76cf537e-16b9-4fd7-b979-9dc5e2e9e3e8', 'cd79c736-a6c7-407c-a7e1-43a19179b8c5');

-- Fix Edward Lake's contact location to West Coast
UPDATE contacts 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id = '6c966998-c6da-471f-85a2-ad6b2ccfca78';
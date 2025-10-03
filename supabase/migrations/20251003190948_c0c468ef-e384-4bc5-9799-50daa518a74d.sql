-- Fix corrupted pipeline entry status
UPDATE pipeline_entries 
SET status = 'lead' 
WHERE id = '8b3d79f5-0932-4d3d-8a8b-75b24252a11d';

-- Standardize new_lead to lead for consistency with pipeline stages
UPDATE pipeline_entries 
SET status = 'lead' 
WHERE status = 'new_lead' 
AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';
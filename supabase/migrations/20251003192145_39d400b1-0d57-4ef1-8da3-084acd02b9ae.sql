-- Fix corrupted pipeline entries with UUID status values
-- These entries were dropped onto other cards instead of columns
UPDATE pipeline_entries 
SET status = 'legal_review' 
WHERE id IN ('56a21974-f7b4-4ddc-a021-8929cb9d3573', '9380f167-1902-47d8-a5ea-f7a80e8aa6e0')
AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';
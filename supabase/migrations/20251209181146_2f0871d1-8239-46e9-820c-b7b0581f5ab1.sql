-- Deactivate the stale 1877 sq ft measurement record
UPDATE measurements 
SET is_active = false 
WHERE id = '0381f6b5-03d2-4a58-a3cb-ff49fbb12618';

-- Fix the pipeline_entries verified_address coordinates (was 0,0)
UPDATE pipeline_entries 
SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"verified_address": {"lat": 27.08202460, "lng": -82.19621560}}'::jsonb
WHERE id = 'a423666b-1d94-4b23-b0fa-8e796f972354';
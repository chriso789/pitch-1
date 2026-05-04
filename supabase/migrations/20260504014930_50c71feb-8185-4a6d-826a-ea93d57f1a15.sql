
-- Delete all measurement-related data for 4063 Fonsica Ave (pipeline entry 5b9ef2b6-59fa-496b-9da6-bd0ee2b182c3)

-- 1. Delete measurement approvals
DELETE FROM measurement_approvals
WHERE pipeline_entry_id = '5b9ef2b6-59fa-496b-9da6-bd0ee2b182c3';

-- 2. Delete roof measurements linked by various keys
DELETE FROM roof_measurements
WHERE lead_id = '5b9ef2b6-59fa-496b-9da6-bd0ee2b182c3'
   OR source_record_id = '5b9ef2b6-59fa-496b-9da6-bd0ee2b182c3'
   OR customer_id = '5b9ef2b6-59fa-496b-9da6-bd0ee2b182c3'
   OR property_address ILIKE '%fonsica%';

-- 3. Delete measurement jobs
DELETE FROM measurement_jobs
WHERE pipeline_entry_id = '5b9ef2b6-59fa-496b-9da6-bd0ee2b182c3';

-- Reassign all FK references from duplicates to keepers, then delete duplicates
-- For each pair, first id is keeper, second is duplicate

-- 2 3/8" Decking Nails (already deleted above, but include for safety)
UPDATE estimate_calc_template_items SET material_id = '3618bd41-49b6-4192-980c-cba2449ec3dd' WHERE material_id = '35aede07-30f6-4a28-91b7-51ae590eb8ae';
DELETE FROM materials WHERE id = '35aede07-30f6-4a28-91b7-51ae590eb8ae';

-- 5V Metal Panels 24ga Painted
UPDATE estimate_calc_template_items SET material_id = '9622129a-a097-44d8-8787-03f451cde732' WHERE material_id = '054f0d03-e268-4722-8561-26b6bafece41';
DELETE FROM materials WHERE id = '054f0d03-e268-4722-8561-26b6bafece41';

-- Butyl Tape 1"
UPDATE estimate_calc_template_items SET material_id = '6bd34872-4319-43ef-9a6c-6802d046293a' WHERE material_id = '96fc1164-4d7b-41e4-892d-eff00a856d79';
DELETE FROM materials WHERE id = '96fc1164-4d7b-41e4-892d-eff00a856d79';

-- Eave Closure Strip
UPDATE estimate_calc_template_items SET material_id = '83e18c46-1961-4a6f-881f-b323c3805b9f' WHERE material_id = '4aa97349-1853-48cf-8e39-8c2307625da0';
DELETE FROM materials WHERE id = '4aa97349-1853-48cf-8e39-8c2307625da0';

-- Metal Hip Cap
UPDATE estimate_calc_template_items SET material_id = '8d5690e2-2c05-41ae-a2ff-dc5868d0a24e' WHERE material_id = 'e29ea1f6-c708-46ea-a472-b3c500d77c1a';
DELETE FROM materials WHERE id = 'e29ea1f6-c708-46ea-a472-b3c500d77c1a';

-- Metal Pipe Boot
UPDATE estimate_calc_template_items SET material_id = '4a81c30c-dba4-45ba-bacf-906c50afd32c' WHERE material_id = '78bc60f8-a11b-43ee-afd2-3d1d668f40bb';
DELETE FROM materials WHERE id = '78bc60f8-a11b-43ee-afd2-3d1d668f40bb';

-- Metal Rake Trim
UPDATE estimate_calc_template_items SET material_id = '028878bf-dc51-4b36-9a4b-707df51e372c' WHERE material_id = '40ccc23a-49fc-412a-a6c1-db604cea67c7';
DELETE FROM materials WHERE id = '40ccc23a-49fc-412a-a6c1-db604cea67c7';

-- Metal Ridge Cap
UPDATE estimate_calc_template_items SET material_id = '3dbf08f3-22bc-4288-8b2f-bce94fa62861' WHERE material_id = '6fd07b2e-2f82-4051-8e1c-39c549f63f93';
DELETE FROM materials WHERE id = '6fd07b2e-2f82-4051-8e1c-39c549f63f93';

-- Pancake Screws #10 x 1"
UPDATE estimate_calc_template_items SET material_id = '346f3f9d-b6fa-4d51-b7cd-c18625ea207d' WHERE material_id = '361a269e-3c67-4c49-98c2-8076f1a905c1';
DELETE FROM materials WHERE id = '361a269e-3c67-4c49-98c2-8076f1a905c1';

-- Polyglass MTS
UPDATE estimate_calc_template_items SET material_id = '5745e7c2-8158-4d6c-98d7-101639b197b7' WHERE material_id = 'dc6a1c08-e94f-4fed-a88d-ee4a0ccdd3b3';
DELETE FROM materials WHERE id = 'dc6a1c08-e94f-4fed-a88d-ee4a0ccdd3b3';

-- Polyglass XFR
UPDATE estimate_calc_template_items SET material_id = 'ff7ac40a-f323-4dc2-818e-c7878b6de68b' WHERE material_id = '7b7f64bb-7fc9-4d4c-8b7e-51cfceacd026';
DELETE FROM materials WHERE id = '7b7f64bb-7fc9-4d4c-8b7e-51cfceacd026';

-- Ridge Closure Strip
UPDATE estimate_calc_template_items SET material_id = 'd7e6fda7-0cc5-4e52-80f8-95a3b424432a' WHERE material_id = '4db05345-3433-4c11-a5d2-854786d14f4d';
DELETE FROM materials WHERE id = '4db05345-3433-4c11-a5d2-854786d14f4d';

-- Valley Metal
UPDATE estimate_calc_template_items SET material_id = '029a11b0-3d29-4d59-8807-77b9b56c085c' WHERE material_id = 'e78cbeee-1fb2-4bd5-86ec-7fa88c7fbe49';
DELETE FROM materials WHERE id = 'e78cbeee-1fb2-4bd5-86ec-7fa88c7fbe49';

-- Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX materials_tenant_name_unique 
ON materials (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), LOWER(name));
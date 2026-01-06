-- Fix Lucy Desloge's pipeline entry and contact to West Coast
UPDATE pipeline_entries 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id = 'c8150cda-4d93-42c3-ba86-3075307cc907';

UPDATE contacts 
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE id = '3a8b10ac-7c13-45e0-9671-432b4d9fde48';

-- Fix user's app_settings to West Coast
UPDATE app_settings 
SET setting_value = '"c490231c-2a0e-4afc-8412-672e1c890c16"',
    updated_at = NOW()
WHERE user_id = '248aad6c-e652-4645-97c3-675d8feb8730'
AND setting_key = 'current_location_id';
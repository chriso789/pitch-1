-- Update Telnyx phone porting status to active for verified numbers
UPDATE locations 
SET phone_porting_status = 'active',
    updated_at = now()
WHERE id IN ('c490231c-2a0e-4afc-8412-672e1c890c16', 'a3615f0d-c7b7-4ee9-a568-a71508a539c6');
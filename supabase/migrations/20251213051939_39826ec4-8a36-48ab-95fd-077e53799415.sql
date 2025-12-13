-- Fix Max Wensinger's profile for Under One Roof
-- User ID: dc2c4ffb-261a-4b04-87a4-cc69af975295

-- 1. Update role from 'corporate' to 'owner'
UPDATE user_roles 
SET role = 'owner' 
WHERE user_id = 'dc2c4ffb-261a-4b04-87a4-cc69af975295';

-- 2. Add phone number to profile
UPDATE profiles 
SET phone = '214-649-5984' 
WHERE id = 'dc2c4ffb-261a-4b04-87a4-cc69af975295';
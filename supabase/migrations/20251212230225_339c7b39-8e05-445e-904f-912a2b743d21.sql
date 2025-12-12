-- Update O'Brien Contracting West Coast location with Telnyx configuration
UPDATE locations SET
  telnyx_phone_number = '+12399194485',
  telnyx_messaging_profile_id = '40019b10-e9de-48f9-9947-827fbc6b76df',
  telnyx_voice_app_id = '2849056557713327385',
  phone_porting_status = 'pending_port'
WHERE id = 'c490231c-2a0e-4afc-8412-672e1c890c16';

-- Update O'Brien Contracting East Coast location with Telnyx configuration
UPDATE locations SET
  telnyx_phone_number = '+15617886050',
  telnyx_messaging_profile_id = '40019b10-e9de-48f9-9947-827fbc6b76df',
  telnyx_voice_app_id = '2849056557713327385',
  phone_porting_status = 'pending_port'
WHERE id = 'a3615f0d-c7b7-4ee9-a568-a71508a539c6';

-- Update communication preferences with actual Telnyx from number
UPDATE communication_preferences SET
  sms_from_number = '+12399194485'
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';
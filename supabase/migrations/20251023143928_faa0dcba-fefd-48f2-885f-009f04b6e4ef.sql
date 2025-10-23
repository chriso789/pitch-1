-- Insert communication preferences for tenant (with mock Asterisk config for testing)
INSERT INTO communication_preferences (
  tenant_id,
  asterisk_api_url,
  asterisk_api_token,
  sms_enabled,
  sms_from_number,
  recording_enabled,
  voicemail_enabled,
  email_enabled
) VALUES (
  '14de934e-7964-4afd-940a-620d2ace125d',
  'http://localhost:4000',
  'mock-token-12345',
  true,
  '+15557654321',
  true,
  true,
  true
) ON CONFLICT (tenant_id) DO UPDATE SET
  asterisk_api_url = COALESCE(EXCLUDED.asterisk_api_url, communication_preferences.asterisk_api_url),
  sms_enabled = COALESCE(EXCLUDED.sms_enabled, communication_preferences.sms_enabled),
  sms_from_number = COALESCE(EXCLUDED.sms_from_number, communication_preferences.sms_from_number);
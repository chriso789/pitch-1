-- Add platform-admin tab to settings_tabs for master users
INSERT INTO settings_tabs (
  tab_key, 
  label, 
  description, 
  icon_name, 
  order_index, 
  is_active, 
  required_role
) VALUES (
  'platform-admin',
  'Platform Admin',
  'Master-level platform administration and communications',
  'Shield',
  200,
  true,
  ARRAY['master']
);
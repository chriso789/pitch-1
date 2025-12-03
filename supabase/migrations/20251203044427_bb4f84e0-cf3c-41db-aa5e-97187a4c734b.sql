-- Add Edge Functions tab to settings_tabs
INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 
  'edge-functions',
  'Edge Functions',
  'Monitor health and performance of critical backend edge functions',
  'Server',
  95,
  true,
  ARRAY['master', 'office_admin']
WHERE NOT EXISTS (
  SELECT 1 FROM settings_tabs WHERE tab_key = 'edge-functions'
);
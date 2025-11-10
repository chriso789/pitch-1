-- Add Cache Management tab to settings (if not exists)
INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 'cache', 'Cache', 'Monitor and manage satellite image caching performance', 'Database', 155, true, ARRAY['master', 'office_admin']::text[]
WHERE NOT EXISTS (
  SELECT 1 FROM settings_tabs WHERE tab_key = 'cache'
);
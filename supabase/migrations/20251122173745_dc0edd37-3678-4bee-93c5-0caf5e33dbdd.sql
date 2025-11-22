-- Add Measurements tab to settings (only if not exists)
INSERT INTO settings_tabs (
  tab_key,
  label,
  description,
  icon_name,
  order_index,
  is_active,
  required_role
)
SELECT 
  'measurements',
  'Measurements',
  'Batch regenerate satellite visualizations with coordinate corrections',
  'MapPin',
  150,
  true,
  ARRAY['master', 'office_admin']::text[]
WHERE NOT EXISTS (
  SELECT 1 FROM settings_tabs WHERE tab_key = 'measurements'
);
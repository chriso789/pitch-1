-- Add Quality Monitoring tab to settings_tabs
INSERT INTO settings_tabs (tenant_id, tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 
  id as tenant_id,
  'quality-monitoring' as tab_key,
  'Quality Monitoring' as label,
  'Real-time measurement system health and coordinate accuracy monitoring' as description,
  'Activity' as icon_name,
  10 as order_index,
  true as is_active,
  ARRAY['master', 'office_admin']::text[] as required_role
FROM tenants
ON CONFLICT (tenant_id, tab_key) DO UPDATE
SET 
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  icon_name = EXCLUDED.icon_name,
  order_index = EXCLUDED.order_index,
  is_active = EXCLUDED.is_active,
  required_role = EXCLUDED.required_role;
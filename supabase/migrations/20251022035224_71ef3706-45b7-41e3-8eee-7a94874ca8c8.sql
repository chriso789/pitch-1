-- Add Lead Sources tab to settings
INSERT INTO settings_tabs (tab_key, label, icon_name, description, order_index, is_active, required_role)
VALUES (
  'lead-sources',
  'Lead Sources',
  'Target',
  'Configure and manage lead generation channels for accurate tracking',
  8,
  true,
  ARRAY['master', 'corporate', 'office_admin', 'regional_manager']
);
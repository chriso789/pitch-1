-- Add Company Activity Log tab to settings_tabs
INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, required_role)
SELECT 
  'company-activity',
  'Company Activity',
  'Audit trail of company switches and user actions',
  'Activity',
  8,
  ARRAY['master', 'office_admin']::text[]
WHERE NOT EXISTS (
  SELECT 1 FROM settings_tabs WHERE tab_key = 'company-activity'
);
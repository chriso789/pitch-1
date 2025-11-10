-- Add Price Management tab to settings
INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 'pricing', 'Pricing', 'Real-time price management and vendor API sync controls', 'DollarSign', 17, true, ARRAY['master', 'office_admin']::TEXT[]
WHERE NOT EXISTS (SELECT 1 FROM settings_tabs WHERE tab_key = 'pricing');
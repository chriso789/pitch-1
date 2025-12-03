-- Add subscription tab to settings
INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 'subscription', 'Subscription', 'Manage subscription plans and billing', 'CreditCard', 25, true, ARRAY['master', 'corporate', 'office_admin']
WHERE NOT EXISTS (SELECT 1 FROM settings_tabs WHERE tab_key = 'subscription');
INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 'ai-admin', 'AI Admin', 'AI-powered admin assistant for config and CRM intelligence', 'Bot', 15, true, '{"master","owner","corporate","office_admin"}'::text[]
WHERE NOT EXISTS (SELECT 1 FROM settings_tabs WHERE tab_key = 'ai-admin');
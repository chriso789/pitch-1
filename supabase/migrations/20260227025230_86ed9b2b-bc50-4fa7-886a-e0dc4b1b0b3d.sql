INSERT INTO settings_tabs (tab_key, label, icon_name, description, is_active, required_role, order_index)
VALUES ('dialer', 'Dialer', 'Phone', 'Configure outbound caller ID and dialing preferences', true, ARRAY['owner', 'master'], 45)
ON CONFLICT (tenant_id, tab_key) DO NOTHING;
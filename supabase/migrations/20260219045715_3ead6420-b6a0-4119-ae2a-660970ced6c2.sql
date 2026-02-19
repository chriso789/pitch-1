-- Restrict AI Admin tab to master role only
UPDATE settings_tabs SET required_role = ARRAY['master'] WHERE tab_key = 'ai-admin';
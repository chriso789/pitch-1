-- Add Integrations tab to settings_tabs if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings_tabs WHERE tab_key = 'integrations') THEN
    INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
    VALUES (
      'integrations',
      'Integrations',
      'Connect GitHub and test AI integrations',
      'Plug',
      150,
      true,
      ARRAY['master', 'corporate']::text[]
    );
  END IF;
END $$;
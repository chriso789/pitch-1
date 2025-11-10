-- Add Security tab to settings_tabs
-- First check if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM settings_tabs WHERE tab_key = 'security'
  ) THEN
    INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
    VALUES (
      'security',
      'Security',
      'Manage security settings, active sessions, and session preferences',
      'Shield',
      50,
      true,
      NULL
    );
  END IF;
END $$;
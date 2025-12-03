-- Add Voice Assistant tab to settings_tabs
INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 
  'voice-assistant',
  'Voice Assistant',
  'Configure voice input and AI assistant settings',
  'Mic',
  25,
  true,
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM settings_tabs WHERE tab_key = 'voice-assistant'
);
-- Update tabs to be visible only to master developers
UPDATE settings_tabs 
SET required_role = ARRAY['master']
WHERE tab_key IN (
  'subscription',
  'security',
  'edge-functions',
  'pricing',
  'quality-monitoring'
);
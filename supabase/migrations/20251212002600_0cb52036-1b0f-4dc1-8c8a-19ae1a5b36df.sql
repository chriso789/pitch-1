-- Make all settings_tabs global by setting tenant_id to NULL
-- This ensures all companies see the same tabs
UPDATE settings_tabs 
SET tenant_id = NULL 
WHERE tenant_id IS NOT NULL;
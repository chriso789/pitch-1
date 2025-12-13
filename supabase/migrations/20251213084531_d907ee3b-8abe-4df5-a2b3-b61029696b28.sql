-- Update company-activity tab to require master role only
UPDATE settings_tabs 
SET required_role = ARRAY['master'] 
WHERE tab_key = 'company-activity';
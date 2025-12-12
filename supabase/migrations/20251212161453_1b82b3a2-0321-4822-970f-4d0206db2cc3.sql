-- Update Commissions tab to use valid role names
UPDATE settings_tabs 
SET required_role = ARRAY['master', 'corporate', 'office_admin', 'regional_manager', 'sales_manager']
WHERE tab_key = 'commissions';

-- Update Users tab to use valid role names
UPDATE settings_tabs 
SET required_role = ARRAY['master', 'corporate', 'office_admin']
WHERE tab_key = 'users';

-- Update QuickBooks tab to use valid role names
UPDATE settings_tabs 
SET required_role = ARRAY['master', 'corporate', 'office_admin']
WHERE tab_key = 'quickbooks';

-- Update Reports tab to use valid role names
UPDATE settings_tabs 
SET required_role = ARRAY['master', 'corporate', 'office_admin']
WHERE tab_key = 'reports';
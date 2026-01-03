-- Add 'owner' role to Users settings tab so company owners can manage users
UPDATE settings_tabs 
SET required_role = ARRAY['master', 'corporate', 'office_admin', 'owner'] 
WHERE tab_key = 'users';

-- Also add owner to company tab to ensure they can manage company settings
UPDATE settings_tabs 
SET required_role = ARRAY['master', 'corporate', 'office_admin', 'owner'] 
WHERE tab_key = 'company';

-- Add owner to commissions tab
UPDATE settings_tabs 
SET required_role = ARRAY['master', 'corporate', 'office_admin', 'owner'] 
WHERE tab_key = 'commissions';

-- Add owner to quickbooks tab
UPDATE settings_tabs 
SET required_role = ARRAY['master', 'corporate', 'office_admin', 'owner'] 
WHERE tab_key = 'quickbooks';
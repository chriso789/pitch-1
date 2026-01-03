-- Reactivate Cox Roofing
UPDATE tenants 
SET is_active = true 
WHERE name ILIKE '%cox%roofing%' AND is_active = false;

-- Add master user access for Cox Roofing (and any other companies they're missing from)
INSERT INTO user_company_access (user_id, tenant_id, access_level, is_active, granted_by)
SELECT 
  p.id as user_id,
  t.id as tenant_id,
  'full' as access_level,
  true as is_active,
  p.id as granted_by
FROM profiles p
CROSS JOIN tenants t
WHERE p.role = 'master'
AND NOT EXISTS (
  SELECT 1 FROM user_company_access uca 
  WHERE uca.user_id = p.id AND uca.tenant_id = t.id
)
ON CONFLICT DO NOTHING;
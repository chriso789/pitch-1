-- Fix Caylan's auth metadata immediately (and any other users with missing tenant_id)
-- This updates auth.users.raw_user_meta_data with the correct tenant info from profiles

-- First, let's fix Caylan specifically (user_id: 78b6adc2-0eec-448d-8836-f94a61ad3918)
UPDATE auth.users 
SET raw_user_meta_data = raw_user_meta_data || jsonb_build_object(
  'tenant_id', '5d250471-1452-4bf1-8f6c-daa6243b3249',
  'active_tenant_id', '5d250471-1452-4bf1-8f6c-daa6243b3249',
  'role', 'owner',
  'company_name', 'Legacy Exteriors'
)
WHERE id = '78b6adc2-0eec-448d-8836-f94a61ad3918';

-- Now fix ALL users who have a valid profile tenant_id but missing auth metadata tenant_id
-- This prevents the issue from happening to any other user
-- Use 'project_manager' as default role since 'user' is not a valid app_role enum
UPDATE auth.users au
SET raw_user_meta_data = au.raw_user_meta_data || jsonb_build_object(
  'tenant_id', p.tenant_id::text,
  'active_tenant_id', COALESCE(p.active_tenant_id, p.tenant_id)::text,
  'role', COALESCE(p.role::text, 'project_manager'),
  'company_name', COALESCE(t.name, '')
)
FROM profiles p
LEFT JOIN tenants t ON t.id = p.tenant_id
WHERE au.id = p.id
  AND p.tenant_id IS NOT NULL
  AND (
    au.raw_user_meta_data->>'tenant_id' IS NULL
    OR au.raw_user_meta_data->>'tenant_id' = ''
  );
-- Step 1: Drop triggers and functions with CASCADE
DROP FUNCTION IF EXISTS sync_profile_role() CASCADE;

-- Step 2: Store existing data temporarily
CREATE TEMP TABLE temp_user_roles AS 
SELECT user_id, role::text as old_role, tenant_id, created_at, created_by
FROM user_roles;

CREATE TEMP TABLE temp_profiles AS
SELECT id, role::text as old_role FROM profiles;

-- Step 3: Drop and recreate enum
DROP TYPE IF EXISTS app_role CASCADE;

CREATE TYPE app_role AS ENUM (
  'master',
  'corporate',
  'office_admin',
  'regional_manager',
  'sales_manager',
  'project_manager'
);

-- Step 4: Add new role column to user_roles
ALTER TABLE user_roles ADD COLUMN role app_role;

UPDATE user_roles ur
SET role = CASE tr.old_role
  WHEN 'admin' THEN 'master'::app_role
  WHEN 'manager' THEN 'corporate'::app_role
  WHEN 'rep' THEN 'sales_manager'::app_role
  WHEN 'user' THEN 'project_manager'::app_role
  ELSE 'project_manager'::app_role
END
FROM temp_user_roles tr
WHERE ur.user_id = tr.user_id;

-- Step 5: Add new role column to profiles
ALTER TABLE profiles ADD COLUMN role app_role;

UPDATE profiles p
SET role = CASE tp.old_role
  WHEN 'admin' THEN 'master'::app_role
  WHEN 'manager' THEN 'corporate'::app_role
  WHEN 'rep' THEN 'sales_manager'::app_role
  WHEN 'user' THEN 'project_manager'::app_role
  ELSE 'project_manager'::app_role
END
FROM temp_profiles tp
WHERE p.id = tp.id;

-- Step 6: Recreate sync function with new roles
CREATE OR REPLACE FUNCTION sync_profile_role()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.profiles
  SET role = (
    SELECT role
    FROM public.user_roles
    WHERE user_id = NEW.user_id
    ORDER BY 
      CASE role
        WHEN 'master'::app_role THEN 1
        WHEN 'corporate'::app_role THEN 2
        WHEN 'office_admin'::app_role THEN 3
        WHEN 'regional_manager'::app_role THEN 4
        WHEN 'sales_manager'::app_role THEN 5
        WHEN 'project_manager'::app_role THEN 6
      END
    LIMIT 1
  )
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_profile_role_trigger
AFTER INSERT OR UPDATE ON user_roles
FOR EACH ROW
EXECUTE FUNCTION sync_profile_role();

-- Step 7: Apply specific user role assignments
UPDATE user_roles 
SET role = 'master'::app_role
WHERE user_id = '0a56229d-1722-4ea0-90ec-c42fdac6fcc9';

UPDATE user_roles 
SET role = 'corporate'::app_role
WHERE user_id IN (
  SELECT id FROM profiles WHERE email IN ('max@underoneroof-tx.com', 'jared@obriencontractingusa.com')
);

UPDATE user_roles 
SET role = 'regional_manager'::app_role
WHERE user_id IN (
  SELECT id FROM profiles WHERE email = 'manifestfreedom3633@gmail.com'
);

UPDATE user_roles 
SET role = 'project_manager'::app_role
WHERE user_id IN (
  SELECT id FROM profiles WHERE email = 'taylrjhnstn@gmail.com'
);

-- Step 8: Delete duplicate user  
DELETE FROM profiles WHERE email = 'maifestfreedom3633@gmail.com';
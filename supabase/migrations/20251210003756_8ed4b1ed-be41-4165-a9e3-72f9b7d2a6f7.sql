-- Step 1: Insert missing user_company_access entry for Chris Riegler
INSERT INTO user_company_access (
  user_id,
  tenant_id,
  access_level,
  is_active,
  granted_at
) VALUES (
  '9cb8216b-28e9-4ad6-a751-75ede6e81b35',
  '14de934e-7964-4afd-940a-620d2ace125d',
  'full',
  true,
  NOW()
) ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Step 2: Set active_tenant_id on Chris Riegler's profile
UPDATE profiles 
SET active_tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
WHERE id = '9cb8216b-28e9-4ad6-a751-75ede6e81b35'
  AND active_tenant_id IS NULL;

-- Step 3: Backfill missing user_company_access records for ALL users
INSERT INTO user_company_access (user_id, tenant_id, access_level, is_active, granted_at)
SELECT p.id, p.tenant_id, 'full', true, NOW()
FROM profiles p
WHERE p.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_company_access uca 
    WHERE uca.user_id = p.id AND uca.tenant_id = p.tenant_id
  )
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Step 4: Set active_tenant_id for users who don't have it set
UPDATE profiles 
SET active_tenant_id = tenant_id
WHERE tenant_id IS NOT NULL
  AND active_tenant_id IS NULL;

-- Step 5: Create trigger function to ensure user_company_access is created for new profiles
CREATE OR REPLACE FUNCTION ensure_user_company_access()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if tenant_id is set
  IF NEW.tenant_id IS NOT NULL THEN
    -- Create user_company_access entry if it doesn't exist
    INSERT INTO user_company_access (user_id, tenant_id, access_level, is_active, granted_at)
    VALUES (NEW.id, NEW.tenant_id, 'full', true, NOW())
    ON CONFLICT (user_id, tenant_id) DO NOTHING;
    
    -- Set active_tenant_id if not already set
    IF NEW.active_tenant_id IS NULL THEN
      NEW.active_tenant_id := NEW.tenant_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Step 6: Create the trigger (drop first if exists)
DROP TRIGGER IF EXISTS ensure_user_company_access_trigger ON profiles;

CREATE TRIGGER ensure_user_company_access_trigger
BEFORE INSERT OR UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION ensure_user_company_access();
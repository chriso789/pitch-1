-- Step 1: Add company_email column to profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS company_email TEXT;

COMMENT ON COLUMN profiles.company_email IS 'Company/business email separate from personal login email';

-- Step 2: Migrate company emails from duplicate profiles BEFORE deleting them
-- Drew Braddock: Keep braddockdrew@yahoo.com profile, add info@laderaroofing.com as company email
UPDATE profiles 
SET company_email = 'info@laderaroofing.com'
WHERE id = 'df5bfde5-ffaf-476b-9828-6fa96aed1bc8';

-- Caylan Tarvin: Keep legacyexterios.co@gmail.com profile, add legacyexteriors.co@gmail.com as company email
UPDATE profiles 
SET company_email = 'legacyexteriors.co@gmail.com'
WHERE id = '78b6adc2-0eec-448d-8836-f94a61ad3918';

-- Step 3: Delete duplicate profiles
DELETE FROM profiles WHERE id = '61900c0d-601f-4f62-84d0-a854ca211af0'; -- Drew Braddock duplicate
DELETE FROM profiles WHERE id = '92c15f29-5f47-447a-ab8d-93b14dde339b'; -- Caylan Tarvin duplicate

-- Step 4: Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_profile_per_tenant 
ON profiles (tenant_id, LOWER(first_name), LOWER(last_name))
WHERE is_active = true;
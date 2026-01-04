-- Add active_location_id column to profiles table
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS active_location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

-- Initialize with the primary location for each user's tenant
UPDATE profiles p
SET active_location_id = (
  SELECT l.id FROM locations l 
  WHERE l.tenant_id = COALESCE(p.active_tenant_id, p.tenant_id) 
  AND l.is_primary = true 
  LIMIT 1
)
WHERE p.active_location_id IS NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_profiles_active_location_id 
ON profiles(active_location_id);
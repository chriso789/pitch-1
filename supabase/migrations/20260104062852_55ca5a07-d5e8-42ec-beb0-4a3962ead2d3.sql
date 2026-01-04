-- Add unique constraint on user_location_assignments to prevent duplicate assignments
ALTER TABLE user_location_assignments 
ADD CONSTRAINT user_location_assignments_user_location_unique 
UNIQUE (user_id, location_id);

-- Create trigger function to auto-assign admins to new locations
CREATE OR REPLACE FUNCTION auto_assign_admin_to_location()
RETURNS TRIGGER AS $$
BEGIN
  -- Get the admin/owner/manager of the tenant and add to user_location_assignments
  INSERT INTO user_location_assignments (user_id, location_id, tenant_id, is_active)
  SELECT p.id, NEW.id, NEW.tenant_id, true
  FROM profiles p
  WHERE p.tenant_id = NEW.tenant_id
  AND p.role IN ('owner', 'master', 'corporate', 'office_admin', 'regional_manager')
  ON CONFLICT (user_id, location_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on locations table
DROP TRIGGER IF EXISTS auto_assign_admins_to_new_location ON locations;
CREATE TRIGGER auto_assign_admins_to_new_location
  AFTER INSERT ON locations
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_admin_to_location();

-- Backfill existing locations: add owners/admins to user_location_assignments
INSERT INTO user_location_assignments (user_id, location_id, tenant_id, is_active)
SELECT p.id, l.id, l.tenant_id, true
FROM profiles p
JOIN locations l ON l.tenant_id = p.tenant_id
WHERE p.role IN ('owner', 'master', 'corporate', 'office_admin', 'regional_manager')
AND NOT EXISTS (
  SELECT 1 FROM user_location_assignments ula
  WHERE ula.user_id = p.id AND ula.location_id = l.id
)
ON CONFLICT (user_id, location_id) DO NOTHING;
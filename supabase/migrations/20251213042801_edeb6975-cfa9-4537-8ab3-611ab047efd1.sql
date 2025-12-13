-- Fix locations table RLS policies for master/multi-company access
-- Problem: Current policies only check get_user_tenant_id() which returns active_tenant_id
-- Solution: Allow access to locations for any company user has access to

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view locations in their tenant" ON locations;
DROP POLICY IF EXISTS "Admins can manage locations" ON locations;

-- Create new SELECT policy that allows:
-- 1. Regular users to see locations in their active tenant
-- 2. Users to see locations in ANY company they have access to via user_company_access
-- 3. Master users to see all locations
CREATE POLICY "Users can view locations in their tenant or accessible companies"
ON locations FOR SELECT
USING (
  -- Regular access: user's active tenant
  tenant_id = get_user_tenant_id()
  OR
  -- Multi-company access: any company user has explicit access to
  tenant_id IN (
    SELECT uca.tenant_id FROM user_company_access uca
    WHERE uca.user_id = auth.uid() 
    AND uca.is_active = true
  )
  OR
  -- Master role has full access to all locations
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() 
    AND ur.role = 'master'
  )
);

-- Create new ALL policy for admins to manage locations
CREATE POLICY "Admins can manage accessible company locations"
ON locations FOR ALL
USING (
  -- Same access rules as SELECT
  tenant_id = get_user_tenant_id()
  OR tenant_id IN (
    SELECT uca.tenant_id FROM user_company_access uca
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
  )
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'master'
  )
)
WITH CHECK (
  -- Only high-level roles can actually modify
  has_high_level_role(auth.uid())
);
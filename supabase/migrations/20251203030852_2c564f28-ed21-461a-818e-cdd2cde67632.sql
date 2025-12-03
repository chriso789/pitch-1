-- Fix RLS INSERT policies for company creation
-- Drop existing policies if they exist (to avoid duplicates)
DROP POLICY IF EXISTS "Admins can create new tenants" ON tenants;
DROP POLICY IF EXISTS "Admins can insert locations" ON locations;
DROP POLICY IF EXISTS "Admins can grant company access" ON user_company_access;

-- Recreate INSERT policies for company creation
CREATE POLICY "Admins can create new tenants"
ON tenants
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role IN ('master', 'corporate', 'office_admin')
  )
);

CREATE POLICY "Admins can insert locations" 
ON locations
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role IN ('master', 'corporate', 'office_admin')
  )
);

CREATE POLICY "Admins can grant company access"
ON user_company_access
FOR INSERT
TO authenticated  
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE profiles.id = auth.uid() 
    AND profiles.role IN ('master', 'corporate', 'office_admin')
  )
);
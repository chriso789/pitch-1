-- Add INSERT policies for company creation workflow

-- Allow admins to insert new tenants (companies)
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

-- Allow admins to insert locations for new tenants
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

-- Allow admins to grant company access
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
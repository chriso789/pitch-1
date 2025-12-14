-- Drop existing restrictive UPDATE policy
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;

-- Create new policy allowing admin updates
CREATE POLICY "Users and admins can update profiles"
ON profiles FOR UPDATE
USING (
  id = auth.uid() 
  OR 
  EXISTS (
    SELECT 1 FROM profiles p 
    WHERE p.id = auth.uid() 
    AND p.role = 'master'
  )
  OR 
  EXISTS (
    SELECT 1 FROM profiles p 
    WHERE p.id = auth.uid() 
    AND p.role IN ('corporate', 'office_admin')
    AND p.tenant_id = profiles.tenant_id
  )
)
WITH CHECK (
  id = auth.uid() 
  OR 
  EXISTS (
    SELECT 1 FROM profiles p 
    WHERE p.id = auth.uid() 
    AND p.role = 'master'
  )
  OR 
  EXISTS (
    SELECT 1 FROM profiles p 
    WHERE p.id = auth.uid() 
    AND p.role IN ('corporate', 'office_admin')
    AND p.tenant_id = profiles.tenant_id
  )
);
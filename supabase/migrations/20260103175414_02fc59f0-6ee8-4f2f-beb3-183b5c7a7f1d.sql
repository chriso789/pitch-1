-- Add RLS policies for user_commission_plans table (INSERT, UPDATE, DELETE)
-- These allow owner, corporate, and master roles to manage commission assignments

-- INSERT policy: Owners, corporate, and master can create commission assignments
CREATE POLICY "Managers can create commission assignments in their tenant"
ON public.user_commission_plans
FOR INSERT
WITH CHECK (
  tenant_id = get_user_tenant_id() 
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('owner'::app_role, 'corporate'::app_role, 'master'::app_role)
  )
);

-- UPDATE policy: Owners, corporate, and master can update commission assignments
CREATE POLICY "Managers can update commission assignments in their tenant"
ON public.user_commission_plans
FOR UPDATE
USING (
  tenant_id = get_user_tenant_id() 
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('owner'::app_role, 'corporate'::app_role, 'master'::app_role)
  )
)
WITH CHECK (
  tenant_id = get_user_tenant_id() 
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('owner'::app_role, 'corporate'::app_role, 'master'::app_role)
  )
);

-- DELETE policy: Owners, corporate, and master can delete commission assignments
CREATE POLICY "Managers can delete commission assignments in their tenant"
ON public.user_commission_plans
FOR DELETE
USING (
  tenant_id = get_user_tenant_id() 
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('owner'::app_role, 'corporate'::app_role, 'master'::app_role)
  )
);

-- Update profiles UPDATE policy to include 'owner' role
-- First drop the existing policy
DROP POLICY IF EXISTS "Users and admins can update profiles" ON public.profiles;

-- Create updated policy that includes 'owner' role
CREATE POLICY "Users and admins can update profiles"
ON public.profiles
FOR UPDATE
USING (
  (id = auth.uid()) 
  OR (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'master'::app_role
  ))
  OR (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() 
    AND p.role IN ('owner'::app_role, 'corporate'::app_role, 'office_admin'::app_role)
    AND p.tenant_id = profiles.tenant_id
  ))
)
WITH CHECK (
  (id = auth.uid()) 
  OR (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'master'::app_role
  ))
  OR (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() 
    AND p.role IN ('owner'::app_role, 'corporate'::app_role, 'office_admin'::app_role)
    AND p.tenant_id = profiles.tenant_id
  ))
);
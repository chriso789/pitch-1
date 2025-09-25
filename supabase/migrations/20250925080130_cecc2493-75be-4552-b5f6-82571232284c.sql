-- Fix RLS tenant and role functions
-- This migration creates the missing functions needed for RLS policies

-- 1. Create or replace get_user_tenant_id function
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Try custom claims first, then fall back to app_metadata
  SELECT COALESCE(
    -- Custom claims in JWT
    (auth.jwt() ->> 'tenant_id')::uuid,
    -- Fallback to app_metadata
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
    -- Final fallback to user's profile tenant_id
    (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );
$$;

-- 2. Create or replace has_role function with single role parameter
CREATE OR REPLACE FUNCTION public.has_role(required_role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Try custom claims first, then fall back to app_metadata, then profile
  SELECT COALESCE(
    -- Custom claims in JWT
    (auth.jwt() ->> 'role')::app_role = required_role,
    -- Fallback to app_metadata
    (auth.jwt() -> 'app_metadata' ->> 'role')::app_role = required_role,
    -- Final fallback to user's profile role
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = required_role,
    -- Default fallback
    false
  );
$$;

-- 3. Create or replace has_any_role function with role array parameter
CREATE OR REPLACE FUNCTION public.has_any_role(required_roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Try custom claims first, then fall back to app_metadata, then profile
  SELECT COALESCE(
    -- Custom claims in JWT
    (auth.jwt() ->> 'role')::app_role = ANY(required_roles),
    -- Fallback to app_metadata
    (auth.jwt() -> 'app_metadata' ->> 'role')::app_role = ANY(required_roles),
    -- Final fallback to user's profile role
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = ANY(required_roles),
    -- Default fallback
    false
  );
$$;

-- 4. Update contacts RLS policy to be more permissive for testing
DROP POLICY IF EXISTS "Users can view active contacts in their tenant" ON public.contacts;

CREATE POLICY "Users can view active contacts in their tenant"
ON public.contacts
FOR SELECT
TO authenticated
USING (
  -- Allow if in same tenant and contact is not deleted
  (tenant_id = get_user_tenant_id() AND is_deleted = false) AND
  -- Allow if user has admin/manager/master role OR no location restriction OR user has location access
  (
    has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]) OR
    location_id IS NULL OR
    EXISTS (
      SELECT 1 FROM user_location_assignments ula
      WHERE ula.tenant_id = get_user_tenant_id()
      AND ula.user_id = auth.uid()
      AND ula.location_id = contacts.location_id
      AND ula.is_active = true
    )
  )
);

-- 5. Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(app_role[]) TO authenticated;
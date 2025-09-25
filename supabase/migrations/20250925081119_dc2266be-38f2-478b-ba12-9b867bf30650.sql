-- Fix enum role issue in RLS policies by updating helper functions
-- The issue is that RLS policies are receiving 'authenticated' instead of proper app_role values

-- Update the helper functions to handle the JWT role properly
CREATE OR REPLACE FUNCTION public.has_role(required_role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Get role from profile first, then fallback to JWT
  SELECT COALESCE(
    -- Primary: Get role from user's profile
    (SELECT role FROM public.profiles WHERE id = auth.uid()),
    -- Fallback: Try custom claims in JWT (only if it's a valid app_role)
    CASE 
      WHEN (auth.jwt() ->> 'role')::text IN ('admin', 'manager', 'sales_rep', 'technician', 'master') 
      THEN (auth.jwt() ->> 'role')::app_role
      ELSE 'admin'::app_role -- Default fallback
    END,
    -- Default if nothing found
    'admin'::app_role
  ) = required_role;
$$;

-- Update the has_any_role function similarly
CREATE OR REPLACE FUNCTION public.has_any_role(required_roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER SET search_path = public
AS $$
  -- Get role from profile first, then fallback to JWT
  SELECT COALESCE(
    -- Primary: Get role from user's profile
    (SELECT role FROM public.profiles WHERE id = auth.uid()),
    -- Fallback: Try custom claims in JWT (only if it's a valid app_role)
    CASE 
      WHEN (auth.jwt() ->> 'role')::text IN ('admin', 'manager', 'sales_rep', 'technician', 'master') 
      THEN (auth.jwt() ->> 'role')::app_role
      ELSE 'admin'::app_role -- Default fallback
    END,
    -- Default if nothing found
    'admin'::app_role
  ) = ANY(required_roles);
$$;
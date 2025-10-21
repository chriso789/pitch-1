-- =====================================================
-- CRITICAL SECURITY FIX: Implement User Roles Table
-- =====================================================
-- This migration creates a proper user_roles table to prevent
-- privilege escalation attacks by moving roles off the profiles table

-- Step 1: Create the app_role enum if it doesn't exist
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('master', 'manager', 'admin', 'user');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Step 2: Create the user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  tenant_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Step 3: Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Step 4: Create helper function to check if user has any of multiple roles
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = ANY(_roles)
  )
$$;

-- Step 5: Create helper function to get user's primary role (highest privilege)
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY 
    CASE role
      WHEN 'master' THEN 1
      WHEN 'manager' THEN 2
      WHEN 'admin' THEN 3
      WHEN 'user' THEN 4
    END
  LIMIT 1
$$;

-- Step 6: Migrate existing roles from profiles to user_roles
INSERT INTO public.user_roles (user_id, role, tenant_id, created_at)
SELECT 
  id as user_id,
  role::app_role,
  tenant_id,
  created_at
FROM public.profiles
WHERE role IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- Step 7: Create RLS policies for user_roles table
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Masters can view all roles in their tenant"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid()
  )
  AND has_role(auth.uid(), 'master')
);

CREATE POLICY "Managers can view roles in their tenant"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid()
  )
  AND has_any_role(auth.uid(), ARRAY['manager', 'master']::app_role[])
);

CREATE POLICY "Masters can manage roles in their tenant"
ON public.user_roles
FOR ALL
TO authenticated
USING (
  tenant_id IN (
    SELECT tenant_id FROM public.user_roles WHERE user_id = auth.uid()
  )
  AND has_role(auth.uid(), 'master')
);

-- Step 8: Add deprecation comment to profiles.role column
COMMENT ON COLUMN public.profiles.role IS 'DEPRECATED: Use user_roles table instead. This column is kept for backward compatibility only.';

-- Step 9: Create trigger to keep profiles.role in sync (for backward compatibility)
CREATE OR REPLACE FUNCTION public.sync_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update profiles table with the highest privilege role
  UPDATE public.profiles
  SET role = (
    SELECT role::text
    FROM public.user_roles
    WHERE user_id = NEW.user_id
    ORDER BY 
      CASE role
        WHEN 'master' THEN 1
        WHEN 'manager' THEN 2
        WHEN 'admin' THEN 3
        WHEN 'user' THEN 4
      END
    LIMIT 1
  )
  WHERE id = NEW.user_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_profile_role_on_user_roles_change
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_role();

-- Step 10: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant_id ON public.user_roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role);

-- Success message
DO $$ 
BEGIN
  RAISE NOTICE 'User roles security migration completed successfully';
  RAISE NOTICE 'Migrated % roles from profiles to user_roles', (SELECT COUNT(*) FROM public.user_roles);
END $$;
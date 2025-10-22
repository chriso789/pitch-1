-- Fix infinite recursion and add user assignment to contacts

-- Step 1: Drop the recursive policy
DROP POLICY IF EXISTS "Users can view profiles in their tenant" ON public.profiles;

-- Step 2: Create security definer function to get user's tenant_id
CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id 
  FROM public.profiles 
  WHERE id = _user_id
  LIMIT 1;
$$;

-- Step 3: Create new policy using the security definer function
CREATE POLICY "Users can view profiles in their tenant"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id(auth.uid())
);

-- Step 4: Add assigned_to column to contacts table
ALTER TABLE public.contacts
ADD COLUMN assigned_to uuid REFERENCES public.profiles(id);

-- Step 5: Add index for performance
CREATE INDEX idx_contacts_assigned_to ON public.contacts(assigned_to);

-- Step 6: Update contacts RLS policies to allow viewing assigned contacts
DROP POLICY IF EXISTS "Users can view contacts assigned to them" ON public.contacts;

CREATE POLICY "Users can view contacts assigned to them"
ON public.contacts
FOR SELECT
TO authenticated
USING (
  assigned_to = auth.uid() OR
  tenant_id = public.get_user_tenant_id(auth.uid())
);
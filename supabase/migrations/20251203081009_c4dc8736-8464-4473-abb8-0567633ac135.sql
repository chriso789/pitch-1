-- Fix RLS INSERT policies on locations and user_company_access tables
-- Replace broken profiles.role check with has_high_level_role() security definer function

-- Step 1: Fix locations INSERT policy
DROP POLICY IF EXISTS "Admins can insert locations" ON public.locations;

CREATE POLICY "Admins can insert locations"
  ON public.locations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_high_level_role(auth.uid())
  );

-- Step 2: Fix user_company_access INSERT policy
DROP POLICY IF EXISTS "Admins can grant company access" ON public.user_company_access;

CREATE POLICY "Admins can grant company access"
  ON public.user_company_access
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_high_level_role(auth.uid())
  );
-- Drop the broken policy that checks profiles.role directly
DROP POLICY IF EXISTS "Admins can create new tenants" ON public.tenants;

-- Create fixed policy using SECURITY DEFINER function
CREATE POLICY "Admins can create new tenants"
  ON public.tenants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_high_level_role(auth.uid())
  );
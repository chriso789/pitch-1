-- Allow high-level users (master, corporate, office_admin) to view ALL tenants
-- This is a PERMISSIVE policy that works alongside "Users can view their own tenant"
CREATE POLICY "Admins can view all tenants"
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    public.has_high_level_role(auth.uid())
  );
-- Add UPDATE policy for tenants table to allow company information edits
CREATE POLICY "Admins can update tenants"
  ON tenants
  FOR UPDATE
  TO authenticated
  USING (has_high_level_role(auth.uid()))
  WITH CHECK (has_high_level_role(auth.uid()));
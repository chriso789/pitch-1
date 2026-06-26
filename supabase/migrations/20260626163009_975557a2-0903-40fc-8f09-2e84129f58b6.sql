
-- Allow master role to manage Centz connections from the Company Administration page.
GRANT INSERT, UPDATE, DELETE ON public.centz_connections TO authenticated;

DROP POLICY IF EXISTS "centz_connections_master_write" ON public.centz_connections;
CREATE POLICY "centz_connections_master_write"
  ON public.centz_connections
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'master'::app_role));

NOTIFY pgrst, 'reload schema';

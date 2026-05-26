
CREATE POLICY "Admins manage QBO connection insert" ON public.qbo_connections
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND (has_role(auth.uid(),'master'::app_role) OR has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'office_admin'::app_role) OR has_role(auth.uid(),'corporate'::app_role)));

CREATE POLICY "Admins manage QBO connection update" ON public.qbo_connections
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND (has_role(auth.uid(),'master'::app_role) OR has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'office_admin'::app_role) OR has_role(auth.uid(),'corporate'::app_role)))
  WITH CHECK (tenant_id = get_user_tenant_id() AND (has_role(auth.uid(),'master'::app_role) OR has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'office_admin'::app_role) OR has_role(auth.uid(),'corporate'::app_role)));

CREATE POLICY "Admins manage QBO connection delete" ON public.qbo_connections
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND (has_role(auth.uid(),'master'::app_role) OR has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'office_admin'::app_role) OR has_role(auth.uid(),'corporate'::app_role)));

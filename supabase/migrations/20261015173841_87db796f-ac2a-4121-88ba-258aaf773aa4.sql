CREATE POLICY "Master and granted users view company locations" ON public.locations FOR SELECT TO authenticated
USING (has_role(auth.uid(),'master'::app_role) OR EXISTS (SELECT 1 FROM public.user_company_access a WHERE a.user_id=auth.uid() AND a.tenant_id=locations.tenant_id AND a.is_active));
CREATE POLICY "Master manages any company locations" ON public.locations FOR UPDATE TO authenticated
USING (has_role(auth.uid(),'master'::app_role)) WITH CHECK (has_role(auth.uid(),'master'::app_role));
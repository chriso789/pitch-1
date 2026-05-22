
CREATE POLICY "Tenant users can delete their blasts" ON public.sms_blasts FOR DELETE USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Tenant users can delete their blast items" ON public.sms_blast_items FOR DELETE USING (EXISTS (SELECT 1 FROM public.sms_blasts b WHERE b.id = sms_blast_items.blast_id AND b.tenant_id IN (SELECT get_user_tenant_ids())));

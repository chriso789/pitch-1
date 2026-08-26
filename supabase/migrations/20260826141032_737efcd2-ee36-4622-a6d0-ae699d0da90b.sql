DROP POLICY IF EXISTS "Users can upload invoices for their tenant" ON storage.objects;
DROP POLICY IF EXISTS "Users can view invoices from their tenant" ON storage.objects;
DROP POLICY IF EXISTS "Users can update invoices from their tenant" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete invoices from their tenant" ON storage.objects;

CREATE POLICY "Users can upload invoices for their tenant"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'project-invoices'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

CREATE POLICY "Users can view invoices from their tenant"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'project-invoices'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

CREATE POLICY "Users can update invoices from their tenant"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'project-invoices'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

CREATE POLICY "Users can delete invoices from their tenant"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'project-invoices'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);
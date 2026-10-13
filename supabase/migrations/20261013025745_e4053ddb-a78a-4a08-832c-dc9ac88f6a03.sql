DROP POLICY IF EXISTS "smartdoc-assets insert tenant scoped" ON storage.objects;
DROP POLICY IF EXISTS "smartdoc-assets read tenant or master" ON storage.objects;
DROP POLICY IF EXISTS "smartdoc-assets update tenant scoped" ON storage.objects;
DROP POLICY IF EXISTS "smartdoc-assets delete tenant scoped" ON storage.objects;

CREATE POLICY "smartdoc-assets insert tenant scoped" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='smartdoc-assets' AND ((storage.foldername(name))[1])::text = ANY (SELECT unnest(public.get_user_tenant_ids(auth.uid()))::text));

CREATE POLICY "smartdoc-assets read tenant or master" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='smartdoc-assets' AND (
  public.has_role(auth.uid(),'master')
  OR (storage.foldername(name))[1] = ANY (SELECT unnest(public.get_user_tenant_ids(auth.uid()))::text)
  OR (name LIKE 'company-docs/%' AND EXISTS (
       SELECT 1 FROM public.documents d
       WHERE d.file_path = storage.objects.name
         AND d.tenant_id = ANY (public.get_user_tenant_ids(auth.uid()))))
));

CREATE POLICY "smartdoc-assets update tenant scoped" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id='smartdoc-assets' AND (storage.foldername(name))[1] = ANY (SELECT unnest(public.get_user_tenant_ids(auth.uid()))::text))
WITH CHECK (bucket_id='smartdoc-assets' AND (storage.foldername(name))[1] = ANY (SELECT unnest(public.get_user_tenant_ids(auth.uid()))::text));

CREATE POLICY "smartdoc-assets delete tenant scoped" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='smartdoc-assets' AND (storage.foldername(name))[1] = ANY (SELECT unnest(public.get_user_tenant_ids(auth.uid()))::text));
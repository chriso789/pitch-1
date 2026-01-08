-- Drop and recreate the update policy
DROP POLICY IF EXISTS "Tenant users can update customer-photos" ON storage.objects;

CREATE POLICY "Tenant users can update customer-photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'customer-photos' AND
  auth.uid() IS NOT NULL AND
  (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM public.profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);
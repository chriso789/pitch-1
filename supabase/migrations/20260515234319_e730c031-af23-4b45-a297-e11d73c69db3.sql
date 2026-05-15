
INSERT INTO storage.buckets (id, name, public)
VALUES ('insurance-scopes', 'insurance-scopes', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Tenant members can read insurance scopes"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'insurance-scopes'
    AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids(auth.uid()))
  );

CREATE POLICY "Tenant members can upload insurance scopes"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'insurance-scopes'
    AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids(auth.uid()))
  );

CREATE POLICY "Tenant members can update insurance scopes"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'insurance-scopes'
    AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids(auth.uid()))
  );

CREATE POLICY "Tenant members can delete insurance scopes"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'insurance-scopes'
    AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids(auth.uid()))
  );

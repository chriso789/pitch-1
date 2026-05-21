
-- ============================================================
-- srs-order-documents: scope SELECT to tenant folder
-- ============================================================
DROP POLICY IF EXISTS "srs_docs_storage_read" ON storage.objects;

CREATE POLICY "srs_docs_storage_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'srs-order-documents'
    AND auth.uid() IS NOT NULL
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_tenant_ids(auth.uid()))
  );

-- ============================================================
-- call-recordings: replace broad INSERT with tenant-scoped one
-- ============================================================
DROP POLICY IF EXISTS "Service role can insert call recordings" ON storage.objects;

CREATE POLICY "Tenant members can insert call recordings"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'call-recordings'
    AND auth.uid() IS NOT NULL
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_tenant_ids(auth.uid()))
  );

-- ============================================================
-- roof-reports: drop broad INSERT/UPDATE/DELETE; add tenant-scoped versions
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can upload reports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update their reports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their reports" ON storage.objects;

CREATE POLICY "Tenant members can upload roof reports"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'roof-reports'
    AND auth.uid() IS NOT NULL
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_tenant_ids(auth.uid()))
  );

CREATE POLICY "Tenant members can update roof reports"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'roof-reports'
    AND auth.uid() IS NOT NULL
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_tenant_ids(auth.uid()))
  )
  WITH CHECK (
    bucket_id = 'roof-reports'
    AND auth.uid() IS NOT NULL
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_tenant_ids(auth.uid()))
  );

CREATE POLICY "Tenant members can delete roof reports"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'roof-reports'
    AND auth.uid() IS NOT NULL
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_tenant_ids(auth.uid()))
  );

-- ============================================================
-- voicemail-drops: replace broad INSERT with tenant-scoped one
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can upload voicemail drops" ON storage.objects;

CREATE POLICY "Tenant members can upload voicemail drops"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'voicemail-drops'
    AND auth.uid() IS NOT NULL
    AND ((storage.foldername(name))[1])::uuid = ANY (get_user_tenant_ids(auth.uid()))
  );

-- ============================================================
-- company-logos: drop broad UPDATE/DELETE; tenant-scoped versions already exist
-- ============================================================
DROP POLICY IF EXISTS "Users can delete logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own logos" ON storage.objects;

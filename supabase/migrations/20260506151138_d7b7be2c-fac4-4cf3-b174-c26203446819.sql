
-- =============================================
-- call-recordings: Remove broad read, fix upload
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can read call recordings" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload call recordings" ON storage.objects;

CREATE POLICY "Tenant-scoped upload call-recordings"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'call-recordings'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

-- =============================================
-- measurement-visualizations: Replace broad policies
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can upload visualizations" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update visualizations" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete visualizations" ON storage.objects;

CREATE POLICY "Tenant-scoped upload measurement-visualizations"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'measurement-visualizations'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

CREATE POLICY "Tenant-scoped update measurement-visualizations"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'measurement-visualizations'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

CREATE POLICY "Tenant-scoped delete measurement-visualizations"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'measurement-visualizations'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

-- =============================================
-- roof-reports: Replace broad policies
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can upload roof reports" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own roof reports" ON storage.objects;

CREATE POLICY "Tenant-scoped upload roof-reports"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'roof-reports'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

CREATE POLICY "Tenant-scoped delete roof-reports"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'roof-reports'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

-- =============================================
-- roof-overlays: Replace broad policies
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can upload roof-overlays" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update their roof-overlays" ON storage.objects;

CREATE POLICY "Tenant-scoped upload roof-overlays"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'roof-overlays'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

CREATE POLICY "Tenant-scoped update roof-overlays"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'roof-overlays'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

-- =============================================
-- ai-admin-uploads: Replace broad policies
-- =============================================
DROP POLICY IF EXISTS "Users can update own uploads in ai-admin-uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own uploads in ai-admin-uploads" ON storage.objects;

CREATE POLICY "Tenant-scoped update ai-admin-uploads"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'ai-admin-uploads'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

CREATE POLICY "Tenant-scoped delete ai-admin-uploads"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'ai-admin-uploads'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

-- =============================================
-- measurement-reports: Replace broad policies
-- =============================================
DROP POLICY IF EXISTS "Authenticated users can upload measurement reports" ON storage.objects;
DROP POLICY IF EXISTS "Tenant members can update measurement reports" ON storage.objects;
DROP POLICY IF EXISTS "Tenant members can write measurement reports" ON storage.objects;

CREATE POLICY "Tenant-scoped upload measurement-reports"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'measurement-reports'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

CREATE POLICY "Tenant-scoped update measurement-reports"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'measurement-reports'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

-- =============================================
-- video-testimonials: Replace public read with tenant-scoped
-- =============================================
DROP POLICY IF EXISTS "Anyone can view video testimonials" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload video testimonials" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete own video testimonials" ON storage.objects;

CREATE POLICY "Tenant-scoped read video-testimonials"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'video-testimonials'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

CREATE POLICY "Tenant-scoped upload video-testimonials"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'video-testimonials'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

CREATE POLICY "Tenant-scoped delete video-testimonials"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'video-testimonials'
  AND (storage.foldername(name))[1] = get_user_tenant_id()::text
);

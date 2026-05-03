
-- 1. ai_measurement_jobs: remove tenant_id IS NULL
DROP POLICY IF EXISTS "ai_measurement_jobs tenant read" ON public.ai_measurement_jobs;
CREATE POLICY "ai_measurement_jobs tenant read"
  ON public.ai_measurement_jobs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR tenant_id = get_user_tenant_id());

-- 2. ai_measurement_images: remove tenant_id IS NULL in join
DROP POLICY IF EXISTS "ai_measurement_images read via job" ON public.ai_measurement_images;
CREATE POLICY "ai_measurement_images read via job"
  ON public.ai_measurement_images FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ai_measurement_jobs j
    WHERE j.id = ai_measurement_images.job_id
      AND (j.user_id = auth.uid() OR j.tenant_id = get_user_tenant_id())
  ));

-- 3. ai_measurement_results
DROP POLICY IF EXISTS "ai_measurement_results read via job" ON public.ai_measurement_results;
CREATE POLICY "ai_measurement_results read via job"
  ON public.ai_measurement_results FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ai_measurement_jobs j
    WHERE j.id = ai_measurement_results.job_id
      AND (j.user_id = auth.uid() OR j.tenant_id = get_user_tenant_id())
  ));

-- 4. ai_roof_planes
DROP POLICY IF EXISTS "ai_roof_planes read via job" ON public.ai_roof_planes;
CREATE POLICY "ai_roof_planes read via job"
  ON public.ai_roof_planes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ai_measurement_jobs j
    WHERE j.id = ai_roof_planes.job_id
      AND (j.user_id = auth.uid() OR j.tenant_id = get_user_tenant_id())
  ));

-- 5. ai_measurement_quality_checks
DROP POLICY IF EXISTS "ai_measurement_quality_checks read via job" ON public.ai_measurement_quality_checks;
CREATE POLICY "ai_measurement_quality_checks read via job"
  ON public.ai_measurement_quality_checks FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ai_measurement_jobs j
    WHERE j.id = ai_measurement_quality_checks.job_id
      AND (j.user_id = auth.uid() OR j.tenant_id = get_user_tenant_id())
  ));

-- 6. roof_measurement_vertices: add tenant filter
DROP POLICY IF EXISTS "Users can view vertices for accessible measurements" ON public.roof_measurement_vertices;
CREATE POLICY "Users can view vertices for accessible measurements"
  ON public.roof_measurement_vertices FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM roof_measurements rm
    WHERE rm.id = roof_measurement_vertices.measurement_id
      AND (rm.measured_by = auth.uid() OR rm.tenant_id = get_user_tenant_id())
  ));

-- 7. roof_measurement_edges: add tenant filter
DROP POLICY IF EXISTS "Users can view edges for accessible measurements" ON public.roof_measurement_edges;
CREATE POLICY "Users can view edges for accessible measurements"
  ON public.roof_measurement_edges FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM roof_measurements rm
    WHERE rm.id = roof_measurement_edges.measurement_id
      AND (rm.measured_by = auth.uid() OR rm.tenant_id = get_user_tenant_id())
  ));

-- 8. roof_measurements: remove measured_by IS NULL branch
DROP POLICY IF EXISTS "Users can view own measurements" ON public.roof_measurements;
CREATE POLICY "Users can view own measurements"
  ON public.roof_measurements FOR SELECT TO authenticated
  USING (measured_by = auth.uid() OR tenant_id = get_user_tenant_id());

-- 9. Storage: replace public read with tenant-scoped
DROP POLICY IF EXISTS "Public can read measurement reports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read measurement reports" ON storage.objects;
CREATE POLICY "Tenant-scoped read measurement-reports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'measurement-reports' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

DROP POLICY IF EXISTS "Anyone can view reports" ON storage.objects;
DROP POLICY IF EXISTS "Public can view roof reports" ON storage.objects;
CREATE POLICY "Tenant-scoped read roof-reports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'roof-reports' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

DROP POLICY IF EXISTS "Public can view visualizations" ON storage.objects;
CREATE POLICY "Tenant-scoped read measurement-visualizations"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'measurement-visualizations' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

DROP POLICY IF EXISTS "Anyone can view roof-overlays" ON storage.objects;
CREATE POLICY "Tenant-scoped read roof-overlays"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'roof-overlays' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

DROP POLICY IF EXISTS "Public read access for ai-admin-uploads" ON storage.objects;
CREATE POLICY "Tenant-scoped read ai-admin-uploads"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ai-admin-uploads' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

DROP POLICY IF EXISTS "AI measurement reports - authenticated read" ON storage.objects;
CREATE POLICY "Tenant-scoped read ai-measurement-reports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ai-measurement-reports' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

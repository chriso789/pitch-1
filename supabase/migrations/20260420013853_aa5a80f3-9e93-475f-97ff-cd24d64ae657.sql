
-- SmartDoc assets storage policies
DROP POLICY IF EXISTS "Authenticated users can read smartdoc-assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to smartdoc-assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update smartdoc-assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete smartdoc-assets" ON storage.objects;

CREATE POLICY "smartdoc-assets read tenant or master"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'smartdoc-assets'
  AND (
    public.has_role(auth.uid(), 'master'::app_role)
    OR (storage.foldername(name))[1] IN (
      SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
      UNION
      SELECT p.active_tenant_id::text FROM public.profiles p WHERE p.id = auth.uid() AND p.active_tenant_id IS NOT NULL
    )
  )
);

CREATE POLICY "smartdoc-assets insert tenant scoped"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'smartdoc-assets'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] IN (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    UNION
    SELECT p.active_tenant_id::text FROM public.profiles p WHERE p.id = auth.uid() AND p.active_tenant_id IS NOT NULL
  )
);

CREATE POLICY "smartdoc-assets update tenant scoped"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'smartdoc-assets'
  AND (storage.foldername(name))[1] IN (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    UNION
    SELECT p.active_tenant_id::text FROM public.profiles p WHERE p.id = auth.uid() AND p.active_tenant_id IS NOT NULL
  )
)
WITH CHECK (
  bucket_id = 'smartdoc-assets'
  AND (storage.foldername(name))[1] IN (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    UNION
    SELECT p.active_tenant_id::text FROM public.profiles p WHERE p.id = auth.uid() AND p.active_tenant_id IS NOT NULL
  )
);

CREATE POLICY "smartdoc-assets delete tenant scoped"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'smartdoc-assets'
  AND (storage.foldername(name))[1] IN (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    UNION
    SELECT p.active_tenant_id::text FROM public.profiles p WHERE p.id = auth.uid() AND p.active_tenant_id IS NOT NULL
  )
);

-- VERTICES
DROP POLICY IF EXISTS "Users can insert vertices for accessible measurements" ON public.roof_measurement_vertices;
DROP POLICY IF EXISTS "Users can update vertices for accessible measurements" ON public.roof_measurement_vertices;
DROP POLICY IF EXISTS "Users can delete vertices for accessible measurements" ON public.roof_measurement_vertices;

CREATE POLICY "Tenant-scoped insert vertices"
ON public.roof_measurement_vertices FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
      AND (
        public.has_role(auth.uid(), 'master'::app_role)
        OR rm.tenant_id IN (SELECT public.get_user_tenant_ids())
      )
  )
);

CREATE POLICY "Tenant-scoped update vertices"
ON public.roof_measurement_vertices FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
      AND (
        public.has_role(auth.uid(), 'master'::app_role)
        OR rm.tenant_id IN (SELECT public.get_user_tenant_ids())
      )
  )
);

CREATE POLICY "Tenant-scoped delete vertices"
ON public.roof_measurement_vertices FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
      AND (
        public.has_role(auth.uid(), 'master'::app_role)
        OR rm.tenant_id IN (SELECT public.get_user_tenant_ids())
      )
  )
);

-- EDGES
DROP POLICY IF EXISTS "Users can insert edges for accessible measurements" ON public.roof_measurement_edges;
DROP POLICY IF EXISTS "Users can update edges for accessible measurements" ON public.roof_measurement_edges;
DROP POLICY IF EXISTS "Users can delete edges for accessible measurements" ON public.roof_measurement_edges;

CREATE POLICY "Tenant-scoped insert edges"
ON public.roof_measurement_edges FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
      AND (
        public.has_role(auth.uid(), 'master'::app_role)
        OR rm.tenant_id IN (SELECT public.get_user_tenant_ids())
      )
  )
);

CREATE POLICY "Tenant-scoped update edges"
ON public.roof_measurement_edges FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
      AND (
        public.has_role(auth.uid(), 'master'::app_role)
        OR rm.tenant_id IN (SELECT public.get_user_tenant_ids())
      )
  )
);

CREATE POLICY "Tenant-scoped delete edges"
ON public.roof_measurement_edges FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.roof_measurements rm
    WHERE rm.id = measurement_id
      AND (
        public.has_role(auth.uid(), 'master'::app_role)
        OR rm.tenant_id IN (SELECT public.get_user_tenant_ids())
      )
  )
);

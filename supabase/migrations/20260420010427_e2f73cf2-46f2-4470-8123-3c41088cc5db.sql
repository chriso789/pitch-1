
-- =========================================================
-- 1. DROP overly permissive "{public}" service-role policies
-- =========================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname='public'
      AND policyname ILIKE 'Service role full access %'
      AND roles = '{public}'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- =========================================================
-- 2. canvassiq_enrichment_logs — restrict INSERT to authed tenant members
-- =========================================================
DROP POLICY IF EXISTS canvassiq_enrichment_insert ON public.canvassiq_enrichment_logs;
CREATE POLICY canvassiq_enrichment_insert
  ON public.canvassiq_enrichment_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

-- =========================================================
-- 3. project-invoices storage — proper tenant-path scoping
-- =========================================================
DROP POLICY IF EXISTS "Users can view invoices from their tenant" ON storage.objects;
DROP POLICY IF EXISTS "Users can update invoices from their tenant" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete invoices from their tenant" ON storage.objects;

CREATE POLICY "Users can view invoices from their tenant"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'project-invoices'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update invoices from their tenant"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'project-invoices'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can delete invoices from their tenant"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'project-invoices'
    AND (storage.foldername(name))[1] IN (
      SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

-- =========================================================
-- 4. Make sensitive storage buckets private
-- =========================================================
UPDATE storage.buckets
SET public = false
WHERE id IN (
  'customer-photos',
  'documents',
  'call-recordings',
  'project-invoices',
  'measurement-reports',
  'measurement-visualizations',
  'ai-admin-uploads',
  'satellite-cache',
  'roof-overlays',
  'roof-reports',
  'video-testimonials'
);

-- =========================================================
-- 5. Recreate SECURITY DEFINER views with security_invoker
-- =========================================================
ALTER VIEW IF EXISTS public.canvass_area_roi SET (security_invoker = true);
ALTER VIEW IF EXISTS public.scope_network_line_items SET (security_invoker = true);
ALTER VIEW IF EXISTS public.scope_network_intelligence SET (security_invoker = true);

-- =========================================================
-- 6. Realtime channel authorization — tenant-scoped
-- =========================================================
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read tenant channels" ON realtime.messages;
CREATE POLICY "Authenticated users can read tenant channels"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    -- Allow if topic begins with the user's tenant_id
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          realtime.topic() LIKE p.tenant_id::text || ':%'
          OR realtime.topic() LIKE 'tenant:' || p.tenant_id::text || ':%'
          OR realtime.topic() = p.tenant_id::text
          OR realtime.topic() LIKE 'user:' || p.id::text || '%'
        )
    )
  );

DROP POLICY IF EXISTS "Authenticated users can write tenant channels" ON realtime.messages;
CREATE POLICY "Authenticated users can write tenant channels"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          realtime.topic() LIKE p.tenant_id::text || ':%'
          OR realtime.topic() LIKE 'tenant:' || p.tenant_id::text || ':%'
          OR realtime.topic() = p.tenant_id::text
          OR realtime.topic() LIKE 'user:' || p.id::text || '%'
        )
    )
  );

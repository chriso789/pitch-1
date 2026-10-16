-- Tighten INSERT policies that allowed anyone (WITH CHECK true) to forge rows.
-- Edge functions use the service role and bypass RLS, so legitimate writes are unaffected.

-- ai_call_transcripts: only members writing into their own tenant
DROP POLICY IF EXISTS "System can insert AI transcripts" ON public.ai_call_transcripts;
CREATE POLICY "Tenant members can insert AI transcripts"
  ON public.ai_call_transcripts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

-- material_import_batches: require a tenant that matches the caller's active company
DROP POLICY IF EXISTS "Authenticated users can insert import batches" ON public.material_import_batches;
CREATE POLICY "Tenant members can insert import batches"
  ON public.material_import_batches FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = get_user_active_tenant_id());

-- Stop showing tenant-less batches to everyone
DROP POLICY IF EXISTS "Tenant members can view import batches" ON public.material_import_batches;
CREATE POLICY "Tenant members can view import batches"
  ON public.material_import_batches FOR SELECT TO authenticated
  USING (tenant_id = get_user_active_tenant_id());

-- training_pairs: require the caller's own tenant
DROP POLICY IF EXISTS "Users can create training pairs" ON public.training_pairs;
CREATE POLICY "Tenant members can create training pairs"
  ON public.training_pairs FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id IN (SELECT (p.tenant_id)::text FROM profiles p WHERE p.id = auth.uid())
  );

-- ============================================================
-- FIX 1: roof_vendor_reports - Add tenant_id, replace permissive policy
-- ============================================================
ALTER TABLE public.roof_vendor_reports ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);

DROP POLICY IF EXISTS "Service role full access on roof_vendor_reports" ON public.roof_vendor_reports;

CREATE POLICY "Users can view their tenant vendor reports"
  ON public.roof_vendor_reports FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert vendor reports for their tenant"
  ON public.roof_vendor_reports FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update their tenant vendor reports"
  ON public.roof_vendor_reports FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can delete their tenant vendor reports"
  ON public.roof_vendor_reports FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- ============================================================
-- FIX 2: admin_access_logs - restrict INSERT to authenticated
-- ============================================================
DROP POLICY IF EXISTS "Service role can insert access logs" ON public.admin_access_logs;
CREATE POLICY "Authenticated users can insert access logs"
  ON public.admin_access_logs FOR INSERT TO authenticated
  WITH CHECK (admin_user_id = auth.uid());

-- ============================================================
-- FIX 3: call_transcripts - restrict INSERT to authenticated
-- ============================================================
DROP POLICY IF EXISTS "Service role can insert transcripts" ON public.call_transcripts;
CREATE POLICY "Authenticated users can insert transcripts for their tenant"
  ON public.call_transcripts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ============================================================
-- FIX 4: building_footprints - restrict to authenticated only (no tenant_id col)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can cache buildings" ON public.building_footprints;
CREATE POLICY "Authenticated users can cache buildings"
  ON public.building_footprints FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- FIX 5: canvassiq_rate_limits - restrict ALL to own user_id
-- ============================================================
DROP POLICY IF EXISTS "canvassiq_rate_limits_all" ON public.canvassiq_rate_limits;
CREATE POLICY "Users can manage their own rate limits"
  ON public.canvassiq_rate_limits FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- FIX 6: satellite_image_cache - restrict writes to authenticated
-- ============================================================
DROP POLICY IF EXISTS "Service role can insert cache metadata" ON public.satellite_image_cache;
DROP POLICY IF EXISTS "Service role can update cache metadata" ON public.satellite_image_cache;

CREATE POLICY "Authenticated users can insert cache metadata"
  ON public.satellite_image_cache FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Authenticated users can update cache metadata"
  ON public.satellite_image_cache FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ============================================================
-- FIX 7: tracking_events - scope authenticated INSERT to tenant
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert tracking events" ON public.tracking_events;
CREATE POLICY "Authenticated users can insert tracking events for tenant"
  ON public.tracking_events FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ============================================================
-- FIX 8: visitor_consents - remove overly permissive ALL policy
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage all consents" ON public.visitor_consents;

-- ============================================================
-- FIX 9: onboarding_analytics - scope INSERT to user
-- ============================================================
DROP POLICY IF EXISTS "Users can insert their own analytics" ON public.onboarding_analytics;
CREATE POLICY "Users can insert their own onboarding analytics"
  ON public.onboarding_analytics FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- FIX 10: walkthrough_analytics - remove duplicate permissive INSERT
-- ============================================================
DROP POLICY IF EXISTS "Users can insert walkthrough analytics" ON public.walkthrough_analytics;

-- ============================================================
-- FIX 11: marketing_sessions - tighten anon/authenticated writes
-- ============================================================
DROP POLICY IF EXISTS "Anon users can create marketing sessions" ON public.marketing_sessions;
DROP POLICY IF EXISTS "Anon users can update marketing sessions" ON public.marketing_sessions;
DROP POLICY IF EXISTS "Authenticated users can create marketing sessions" ON public.marketing_sessions;
DROP POLICY IF EXISTS "Authenticated users can update marketing sessions" ON public.marketing_sessions;

CREATE POLICY "Anon can create marketing sessions"
  ON public.marketing_sessions FOR INSERT TO anon
  WITH CHECK (channel = 'MARKETING_SITE');

CREATE POLICY "Anon can update own marketing sessions"
  ON public.marketing_sessions FOR UPDATE TO anon
  USING (user_id IS NULL)
  WITH CHECK (channel = 'MARKETING_SITE');

CREATE POLICY "Authenticated users can create their marketing sessions"
  ON public.marketing_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Authenticated users can update their marketing sessions"
  ON public.marketing_sessions FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL)
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

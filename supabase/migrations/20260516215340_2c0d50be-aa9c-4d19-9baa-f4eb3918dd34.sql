
-- 1. Insurance shared tables: restrict writes to master/corporate roles
DROP POLICY IF EXISTS "Authenticated users can insert mappings" ON public.insurance_line_item_mappings;
DROP POLICY IF EXISTS "Verifier can update mappings" ON public.insurance_line_item_mappings;

CREATE POLICY "Master/corporate can insert insurance mappings"
ON public.insurance_line_item_mappings
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'master') OR public.has_role(auth.uid(), 'corporate'));

CREATE POLICY "Master/corporate can update insurance mappings"
ON public.insurance_line_item_mappings
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'master') OR public.has_role(auth.uid(), 'corporate'))
WITH CHECK (public.has_role(auth.uid(), 'master') OR public.has_role(auth.uid(), 'corporate'));

DROP POLICY IF EXISTS "Authenticated users can insert contributions" ON public.insurance_network_contributions;

CREATE POLICY "Master/corporate can insert insurance contributions"
ON public.insurance_network_contributions
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'master') OR public.has_role(auth.uid(), 'corporate'));

-- 2. report_packet_signatures: restrict INSERT to authenticated tenant members
DROP POLICY IF EXISTS "Anyone can insert signatures" ON public.report_packet_signatures;
DROP POLICY IF EXISTS "Public can insert signatures" ON public.report_packet_signatures;

CREATE POLICY "Tenant members can insert report packet signatures"
ON public.report_packet_signatures
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.user_company_access
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- 3. system_crashes / health_checks / system_metrics: restrict SELECT to master role
DROP POLICY IF EXISTS "Authenticated can view system_crashes" ON public.system_crashes;
DROP POLICY IF EXISTS "Authenticated users can view system crashes" ON public.system_crashes;
DROP POLICY IF EXISTS "Authenticated can view health_checks" ON public.health_checks;
DROP POLICY IF EXISTS "Authenticated users can view health checks" ON public.health_checks;
DROP POLICY IF EXISTS "Authenticated can view system_metrics" ON public.system_metrics;
DROP POLICY IF EXISTS "Authenticated users can view system metrics" ON public.system_metrics;

CREATE POLICY "Master can view system crashes"
ON public.system_crashes FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'master'));

CREATE POLICY "Master can view health checks"
ON public.health_checks FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'master'));

CREATE POLICY "Master can view system metrics"
ON public.system_metrics FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'master'));

-- 4. ai_usage_metrics: require auth + tenant
DROP POLICY IF EXISTS "Anyone can insert ai usage metrics" ON public.ai_usage_metrics;
DROP POLICY IF EXISTS "Public can insert ai usage metrics" ON public.ai_usage_metrics;

CREATE POLICY "Authenticated users can insert ai usage metrics for their tenant"
ON public.ai_usage_metrics
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL AND tenant_id = public.get_user_tenant_id());

-- 5. report_packet_events: restrict to authenticated tenant members
DROP POLICY IF EXISTS "Anyone can insert packet events" ON public.report_packet_events;
DROP POLICY IF EXISTS "Public can insert packet events" ON public.report_packet_events;

CREATE POLICY "Tenant members can insert report packet events"
ON public.report_packet_events
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM public.user_company_access
    WHERE user_id = auth.uid() AND is_active = true
  )
);

-- 6. company_activity_log / user_activity_log: require authentication
DROP POLICY IF EXISTS "Anyone can insert activity log" ON public.company_activity_log;
DROP POLICY IF EXISTS "Public can insert activity" ON public.company_activity_log;
DROP POLICY IF EXISTS "Anyone can insert user activity" ON public.user_activity_log;
DROP POLICY IF EXISTS "Public can insert user activity" ON public.user_activity_log;

CREATE POLICY "Authenticated users can insert company activity log"
ON public.company_activity_log
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert user activity log"
ON public.user_activity_log
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- 7. Convert smartdoc-assets bucket to private
UPDATE storage.buckets SET public = false WHERE id = 'smartdoc-assets';

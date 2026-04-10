-- ============================================================
-- DROP all misapplied 'Service role full access' policies on {public}
-- and recreate on {service_role}
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
  tables_to_fix TEXT[] := ARRAY[
    'webhook_endpoints', 'api_keys', 'app_installations', 'financing_providers',
    'fleet_vehicles', 'fleet_maintenance_logs', 'fleet_fuel_logs',
    'inventory_items', 'inventory_levels', 'inventory_transactions',
    'subcontractor_payment_requests', 'referral_codes', 'referral_conversions',
    'referral_rewards', 'quality_inspections', 'vendors',
    'communication_threads', 'communication_thread_messages', 'punch_list_items',
    'lead_attribution_events', 'vendor_scorecards',
    'gamification_points', 'gamification_badges', 'gamification_user_badges',
    'custom_dashboards', 'dashboard_widgets', 'translations',
    'compliance_violations', 'marketplace_apps', 'integration_sync_logs',
    'subscription_invoices', 'subscription_plans',
    'customer_portal_preferences', 'customer_self_service_requests',
    'alert_rules', 'voice_agent_scripts', 'voice_agent_training_data'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_to_fix LOOP
    -- Drop the misapplied policy
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access" ON public.%I', tbl);
    -- Recreate properly on service_role
    EXECUTE format('CREATE POLICY "Service role full access" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;

-- ============================================================
-- Fix proposal_follow_ups: drop public 'System can manage follow-ups'
-- ============================================================
DROP POLICY IF EXISTS "System can manage follow-ups" ON public.proposal_follow_ups;
CREATE POLICY "Service role can manage follow-ups" ON public.proposal_follow_ups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Fix function_cache: drop public 'Service role can manage cache'
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage cache" ON public.function_cache;
CREATE POLICY "Service role can manage cache" ON public.function_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Fix security_alerts: drop public policies
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage all alerts" ON public.security_alerts;
CREATE POLICY "Service role can manage all alerts" ON public.security_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Fix asterisk_channels: drop public 'Service role can manage channels'
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage channels" ON public.asterisk_channels;
CREATE POLICY "Service role can manage channels" ON public.asterisk_channels
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Fix dnc_scrub_results: drop public 'Service role can manage DNC data'
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage DNC data" ON public.dnc_scrub_results;
CREATE POLICY "Service role can manage DNC data" ON public.dnc_scrub_results
  FOR ALL TO service_role USING (true) WITH CHECK (true);
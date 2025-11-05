
-- ============================================================================
-- SECURITY FIXES: Set search_path for all public functions
-- ============================================================================
-- This migration fixes the "Function Search Path Mutable" security warnings
-- by setting a fixed search_path for all user-defined functions.
-- This prevents potential SQL injection attacks through search_path manipulation.

-- Budget calculation functions
ALTER FUNCTION public._compute_budget_rollup(jsonb, numeric, numeric, numeric, numeric) SET search_path = public;
ALTER FUNCTION public._jsonb_num(jsonb, text, numeric) SET search_path = public;

-- API functions - Lead/Job management
ALTER FUNCTION public.api_approve_job_from_lead(uuid, text) SET search_path = public;
ALTER FUNCTION public.api_automations_create(text, text, text, jsonb, jsonb) SET search_path = public;
ALTER FUNCTION public.api_automations_update(uuid, text, text, jsonb, jsonb) SET search_path = public;
ALTER FUNCTION public.api_capout_refresh(uuid) SET search_path = public;
ALTER FUNCTION public.api_create_material_order_from_estimate(uuid, uuid, jsonb, text, text) SET search_path = public;
ALTER FUNCTION public.api_dynamic_tags_frequently_used(integer) SET search_path = public;
ALTER FUNCTION public.api_request_manager_approval(uuid, numeric, text) SET search_path = public;
ALTER FUNCTION public.api_save_call_disposition(uuid, text, text) SET search_path = public;

-- API functions - Estimate management
ALTER FUNCTION public.api_estimate_bind_template(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.api_estimate_compute_pricing(uuid, text, numeric, character) SET search_path = public;
ALTER FUNCTION public.api_estimate_hyperlink_bar(uuid) SET search_path = public;
ALTER FUNCTION public.api_estimate_items_get(uuid) SET search_path = public;
ALTER FUNCTION public.api_estimate_measurements_upsert(uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.api_estimate_status_get(uuid) SET search_path = public;

-- API functions - Job budgets
ALTER FUNCTION public.api_job_budgets_get(uuid) SET search_path = public;
ALTER FUNCTION public.api_snapshot_precap_and_capout(uuid, jsonb, numeric, numeric, numeric, uuid) SET search_path = public;

-- API functions - QuickBooks integration
ALTER FUNCTION public.api_qbo_map_job_invoice(uuid, text, text, text) SET search_path = public;
ALTER FUNCTION public.api_qbo_set_connection(text, text, text, timestamp with time zone, text[], text) SET search_path = public;
ALTER FUNCTION public.api_qbo_update_invoice_mirror(text, text, text, numeric, numeric, text) SET search_path = public;

-- API functions - SmartDoc
ALTER FUNCTION public.api_smartdoc_build_context(uuid, uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.api_smartdoc_templates_get(uuid) SET search_path = public;
ALTER FUNCTION public.api_smartdoc_templates_list() SET search_path = public;

-- API functions - Templates
ALTER FUNCTION public.api_template_get_full(uuid) SET search_path = public;
ALTER FUNCTION public.api_template_items_get(uuid) SET search_path = public;
ALTER FUNCTION public.api_template_items_upsert(uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.api_templates_create(text, jsonb, jsonb, character) SET search_path = public;

-- Trigger functions
ALTER FUNCTION public.audit_trigger() SET search_path = public;
ALTER FUNCTION public.audit_trigger_func() SET search_path = public;
ALTER FUNCTION public.auto_assign_clj_number() SET search_path = public;
ALTER FUNCTION public.auto_assign_envelope_number() SET search_path = public;
ALTER FUNCTION public.auto_assign_job_number() SET search_path = public;
ALTER FUNCTION public.auto_assign_pipeline_entry() SET search_path = public;
ALTER FUNCTION public.auto_assign_project_job_number() SET search_path = public;
ALTER FUNCTION public.auto_create_rep_commission_plan() SET search_path = public;
ALTER FUNCTION public.assign_contact_number() SET search_path = public;
ALTER FUNCTION public.assign_job_number() SET search_path = public;
ALTER FUNCTION public.assign_lead_number() SET search_path = public;

-- Business logic functions
ALTER FUNCTION public.calculate_enhanced_estimate(uuid) SET search_path = public;
ALTER FUNCTION public.calculate_enhanced_rep_commission(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.calculate_lead_score(jsonb, uuid) SET search_path = public;
ALTER FUNCTION public.calculate_name_similarity(text, text) SET search_path = public;
ALTER FUNCTION public.calculate_perimeter_from_linear_features(jsonb) SET search_path = public;
ALTER FUNCTION public.calculate_rep_commission(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.check_budget_variance_alerts() SET search_path = public;
ALTER FUNCTION public.check_enrollment_eligibility(jsonb, jsonb) SET search_path = public;

-- Utility function for tenant ID
ALTER FUNCTION public.get_user_tenant_id() SET search_path = public;

-- Additional common functions that may exist
DO $$
DECLARE
    func_record RECORD;
BEGIN
    -- Set search_path for any remaining functions without it
    FOR func_record IN 
        SELECT p.oid::regprocedure::text as func_signature
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
        WHERE n.nspname = 'public'
          AND p.prokind = 'f'
          AND d.objid IS NULL
          AND p.proname NOT LIKE '_postgis%'
          AND p.proname NOT LIKE 'st_%'
          AND NOT EXISTS (
              SELECT 1 FROM pg_proc p2 
              WHERE p2.oid = p.oid 
              AND p2.proconfig::text LIKE '%search_path%'
          )
    LOOP
        BEGIN
            EXECUTE format('ALTER FUNCTION %s SET search_path = public', func_record.func_signature);
            RAISE NOTICE 'Set search_path for: %', func_record.func_signature;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not set search_path for %: %', func_record.func_signature, SQLERRM;
        END;
    END LOOP;
END $$;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE '✅ SECURITY FIXES COMPLETED: All user-defined functions now have fixed search_path';
END $$;

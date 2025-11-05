-- ============================================================================
-- FIX FUNCTION SEARCH_PATH - ONLY EXISTING FUNCTIONS
-- ============================================================================

DO $$
DECLARE
  func_sig text;
BEGIN
  -- Only alter functions that actually exist
  FOR func_sig IN 
    SELECT format('%I.%I(%s)', 
      n.nspname, 
      p.proname, 
      pg_get_function_identity_arguments(p.oid)
    )
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'api_approve_job_from_lead',
        'api_automations_create',
        'api_automations_update',
        'api_create_material_order_from_estimate',
        'api_dynamic_tags_frequently_used',
        'api_job_budgets_get',
        'api_qbo_map_job_invoice',
        'api_qbo_set_connection',
        'api_qbo_update_invoice_mirror',
        'api_request_manager_approval',
        'api_save_call_disposition',
        'api_smartdoc_build_context',
        'api_smartdoc_templates_get',
        'api_smartdoc_templates_list',
        'assign_contact_number',
        'assign_job_number',
        'assign_lead_number',
        'auto_assign_clj_number',
        'auto_assign_envelope_number',
        'auto_assign_job_number',
        'auto_assign_pipeline_entry',
        'auto_assign_project_job_number',
        'auto_create_rep_commission_plan',
        'calculate_enhanced_estimate',
        'calculate_enhanced_rep_commission',
        'calculate_lead_score',
        'calculate_name_similarity',
        'calculate_perimeter_from_linear_features',
        'calculate_rep_commission',
        'check_budget_variance_alerts',
        'check_enrollment_eligibility',
        'check_location_radius',
        'check_subcontractor_capacity',
        'check_subcontractor_compliance',
        'create_estimate_version',
        'create_job_from_pipeline',
        'create_production_workflow',
        'create_project_from_estimate',
        'detect_contact_duplicates',
        'enforce_manager_approval_gate',
        'est_bind_template',
        'est_compute_pricing',
        'est_eval_qty',
        'est_ingest_measurements',
        'est_sanitize_formula',
        'extract_tokens',
        'format_clj_number',
        'generate_clj_number',
        'get_user_tenant_id',
        'has_any_role',
        'update_updated_at'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', func_sig);
  END LOOP;
END;
$$;
-- The previous REVOKEs from anon were insufficient: these functions carry the
-- default PUBLIC grant, which anon inherits. Revoke from PUBLIC and re-grant
-- to authenticated (service_role already has ALL via ownership/grants).

DO $$
DECLARE
  fn text;
  sigs text[] := ARRAY[
    'generate_clj_number()',
    'generate_contact_number()',
    'generate_envelope_number()',
    'generate_job_number()',
    'generate_po_number()',
    'generate_project_job_number()',
    'generate_project_job_number(uuid, uuid)',
    'generate_referral_code(uuid, uuid)',
    'generate_signature_access_token()',
    'generate_simple_job_number()',
    'generate_simple_job_number(uuid)',
    'get_next_contact_number(uuid, uuid)',
    'get_next_job_number(uuid)',
    'get_next_job_number(uuid, integer, integer)',
    'get_next_lead_number(uuid)',
    'emit_domain_event(uuid, text, text, uuid, jsonb, text, text, uuid, uuid)',
    'log_function_error(text, text, jsonb, text)',
    'check_rate_limit(uuid, text, integer, integer)',
    'increment_estimate_views(uuid)',
    'get_workspace_bootstrap()',
    'resolve_request_tenant_id()',
    'get_crew_dashboard_jobs()',
    'get_crew_dashboard_jobs(uuid)',
    'get_crew_job_detail(uuid, uuid)',
    'get_crew_job_photos(uuid, uuid)',
    'insert_crew_job_photo(uuid, uuid, uuid, uuid, text, numeric, numeric)',
    'get_crew_user_companies()',
    'get_crew_company_user_for_company(uuid, uuid)',
    'get_crew_subcontractor_profile_for_company(uuid, uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY sigs LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;
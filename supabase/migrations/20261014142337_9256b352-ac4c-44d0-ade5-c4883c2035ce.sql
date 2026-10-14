DO $$
DECLARE r record;
  keep text[] := ARRAY['confirm_demo_slot_by_token','get_demo_request_by_token','get_public_crm_referral_link','get_public_referral_link','get_public_referral_reward_profile','submit_demo_request','submit_demo_request_slots','submit_public_referral','track_public_referral_event','track_slide_view','validate_presentation_token','start_presentation_session','complete_presentation_session','resolve_invoice_portal_token','validate_canvass_token','increment_estimate_views','log_signature_event','generate_signature_access_token','check_opt_out','check_rate_limit','log_function_error','emit_domain_event','resolve_request_tenant_id','insert_crew_job_photo','update_crew_job_status','get_crew_company_user_for_company','get_crew_dashboard_jobs','get_crew_job_detail','get_crew_job_photos','get_crew_subcontractor_profile_for_company','get_crew_user_companies','get_workspace_bootstrap'];
  pol text;
BEGIN
  SELECT string_agg(coalesce(qual,'')||' '||coalesce(with_check,''),' ') INTO pol FROM pg_policies;
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
    LEFT JOIN pg_depend d ON d.objid=p.oid AND d.deptype='e'
    WHERE s.nspname='public' AND p.prosecdef AND d.objid IS NULL AND has_function_privilege('anon',p.oid,'execute')
  LOOP
    CONTINUE WHEN r.proname = ANY(keep) OR r.proname LIKE 'generate\_%' OR r.proname LIKE 'get\_next\_%' OR pol ~ ('\m'||r.proname||'\M');
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;
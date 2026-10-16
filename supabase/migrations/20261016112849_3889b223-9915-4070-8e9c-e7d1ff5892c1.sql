-- Revoke EXECUTE from anon on internal SECURITY DEFINER functions.
-- Kept for anon: functions used by RLS policies (has_role, get_user_tenant_id, etc.)
-- and functions powering public pages (demo requests, referral links, invoice portal
-- tokens, presentation/signature sessions, storage access checks).
-- authenticated and service_role keep their existing grants.

REVOKE EXECUTE ON FUNCTION public.generate_clj_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_contact_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_envelope_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_job_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_po_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_project_job_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_project_job_number(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_referral_code(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_signature_access_token() FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_simple_job_number() FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_simple_job_number(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_next_contact_number(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_next_job_number(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_next_job_number(uuid, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_next_lead_number(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.emit_domain_event(uuid, text, text, uuid, jsonb, text, text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_function_error(text, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_estimate_views(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_workspace_bootstrap() FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_request_tenant_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_crew_dashboard_jobs() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_crew_dashboard_jobs(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_crew_job_detail(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_crew_job_photos(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_crew_job_photo(uuid, uuid, uuid, uuid, text, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_crew_user_companies() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_crew_company_user_for_company(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_crew_subcontractor_profile_for_company(uuid, uuid) FROM anon;
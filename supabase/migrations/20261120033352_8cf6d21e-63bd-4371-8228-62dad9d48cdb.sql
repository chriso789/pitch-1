-- 1) Pin search_path on functions flagged as mutable (bodies already fully schema-qualified)
ALTER FUNCTION crew.is_admin(uuid) SET search_path = crew, public;
ALTER FUNCTION crew.is_assigned_to_job(uuid, uuid) SET search_path = crew, public;
ALTER FUNCTION crew.set_updated_at() SET search_path = crew, public;
ALTER FUNCTION crew.is_subcontractor(uuid) SET search_path = crew, public;
ALTER FUNCTION crew.sub_docs_valid(uuid, uuid) SET search_path = crew, public;
ALTER FUNCTION crew.photo_requirements_met(uuid, uuid, uuid) SET search_path = crew, public;
ALTER FUNCTION crew.my_company_id() SET search_path = crew, public;
ALTER FUNCTION crew.checklist_met(uuid, uuid, uuid) SET search_path = crew, public;
ALTER FUNCTION crew.can_complete_job(uuid, uuid, uuid) SET search_path = crew, public;
ALTER FUNCTION crew.enforce_completion_gate() SET search_path = crew, public;
ALTER FUNCTION crew.seed_roofing_defaults(uuid) SET search_path = crew, public;
ALTER FUNCTION crew.storage_company_id_from_name(text) SET search_path = crew, public;
ALTER FUNCTION crew.storage_sub_user_id_from_name(text) SET search_path = crew, public;
ALTER FUNCTION crew.storage_job_id_from_name(text) SET search_path = crew, public;
ALTER FUNCTION public.set_canvass_photos_updated_at() SET search_path = public;

-- 2) Trigger function: never callable directly
REVOKE ALL ON FUNCTION public.photo_finding_approval_guard() FROM PUBLIC, anon, authenticated;

-- 3) Signed-in only (not used by any public page or anonymous policy)
REVOKE ALL ON FUNCTION public.get_pdf_ws_tenant_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pdf_ws_tenant_id(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_high_level_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_high_level_role(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.current_user_crew_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_crew_id() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_crew_job_status(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_crew_job_status(uuid, text, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.generate_presentation_token(uuid, uuid, interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_presentation_token(uuid, uuid, interval) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.log_signature_event(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_signature_event(uuid, uuid, text, text, jsonb) TO authenticated, service_role;

-- 4) Server-only (called exclusively by backend functions with the service key)
REVOKE ALL ON FUNCTION public.check_opt_out(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_opt_out(uuid, text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_demo_request_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_demo_request_by_token(text) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_invoice_portal_token(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_invoice_portal_token(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.validate_canvass_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_canvass_token(text) TO service_role;

-- 5) Share links can only be created by members of the presentation's company
CREATE OR REPLACE FUNCTION public.generate_presentation_token(p_presentation_id uuid, p_contact_id uuid DEFAULT NULL::uuid, p_expires_in interval DEFAULT '7 days'::interval)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token TEXT;
  v_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM public.presentations
  WHERE id = p_presentation_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Presentation not found';
  END IF;

  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     AND (auth.uid() IS NULL OR NOT public.user_can_access_tenant(v_tenant_id)) THEN
    RAISE EXCEPTION 'Presentation not found' USING ERRCODE = '42501';
  END IF;

  v_token := encode(gen_random_bytes(32), 'base64');

  INSERT INTO public.presentation_sessions (
    tenant_id, presentation_id, contact_id, status, viewer_metadata
  ) VALUES (
    v_tenant_id, p_presentation_id, p_contact_id, 'pending',
    jsonb_build_object(
      'access_token', v_token,
      'expires_at', (now() + p_expires_in)::text,
      'link_generated_by', auth.uid()
    )
  );

  RETURN v_token;
END;
$function$;

-- 6) Signature audit events can only be written for envelopes in the caller's company
CREATE OR REPLACE FUNCTION public.log_signature_event(p_envelope_id uuid, p_recipient_id uuid, p_event_type text, p_description text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_tenant_id UUID;
    v_event_id UUID;
BEGIN
    SELECT tenant_id INTO v_tenant_id
    FROM public.signature_envelopes
    WHERE id = p_envelope_id;

    IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
       AND (auth.uid() IS NULL OR v_tenant_id IS NULL OR NOT public.user_can_access_tenant(v_tenant_id)) THEN
      RAISE EXCEPTION 'Envelope not found' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.signature_events (
        tenant_id, envelope_id, recipient_id, event_type, event_description, event_metadata
    ) VALUES (
        v_tenant_id, p_envelope_id, p_recipient_id, p_event_type, p_description, p_metadata
    ) RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$function$;
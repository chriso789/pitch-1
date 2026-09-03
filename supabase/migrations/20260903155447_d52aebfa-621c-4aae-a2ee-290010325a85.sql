CREATE OR REPLACE FUNCTION public.resolve_request_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw text;
  v_tenant uuid;
  v_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_raw := current_setting('request.headers', true)::json ->> 'x-pitch-tenant';
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  IF v_raw IS NULL OR v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;

  v_tenant := v_raw::uuid;

  SELECT EXISTS(
    SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.tenant_id = v_tenant OR p.role = 'master')
    UNION ALL
    SELECT 1 FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid() AND uca.tenant_id = v_tenant AND uca.is_active = true
  ) INTO v_ok;

  IF v_ok THEN
    RETURN v_tenant;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_active_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active_tenant_id UUID;
  v_tenant_id UUID;
  v_request_tenant UUID;
BEGIN
  v_request_tenant := public.resolve_request_tenant_id();
  IF v_request_tenant IS NOT NULL THEN
    RETURN v_request_tenant;
  END IF;

  SELECT active_tenant_id, tenant_id
  INTO v_active_tenant_id, v_tenant_id
  FROM profiles
  WHERE id = auth.uid();

  RETURN COALESCE(v_active_tenant_id, v_tenant_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    public.resolve_request_tenant_id(),
    (SELECT active_tenant_id FROM public.profiles WHERE id = auth.uid()),
    (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    CASE WHEN _user_id = auth.uid() THEN public.resolve_request_tenant_id() ELSE NULL END,
    (SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = _user_id LIMIT 1)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_request_tenant_id() TO authenticated, service_role;
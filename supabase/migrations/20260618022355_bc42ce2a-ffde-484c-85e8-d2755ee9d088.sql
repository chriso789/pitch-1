CREATE OR REPLACE FUNCTION public.get_users_last_login(_user_ids uuid[])
RETURNS TABLE(user_id uuid, last_sign_in_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _caller_role app_role;
  _caller_tenant uuid;
BEGIN
  IF _caller IS NULL THEN
    RETURN;
  END IF;

  SELECT role, tenant_id INTO _caller_role, _caller_tenant
  FROM public.profiles WHERE id = _caller;

  RETURN QUERY
  SELECT u.id, u.last_sign_in_at
  FROM auth.users u
  WHERE u.id = ANY(_user_ids)
    AND (
      u.id = _caller
      OR _caller_role = 'master'::app_role
      OR EXISTS (
        SELECT 1 FROM public.profiles t
        WHERE t.id = u.id
          AND (
            t.tenant_id = _caller_tenant
            OR EXISTS (
              SELECT 1 FROM public.user_company_access uca
              WHERE uca.user_id = _caller AND uca.tenant_id = t.tenant_id AND uca.is_active = true
            )
          )
      )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_users_last_login(uuid[]) TO authenticated;
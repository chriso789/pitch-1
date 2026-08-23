ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_by_tenant boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_tenant_login_access(p_tenant_id uuid, p_active boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_role public.app_role;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  IF v_role IS DISTINCT FROM 'master' THEN
    RAISE EXCEPTION 'Only master users can change company login access';
  END IF;

  IF p_active THEN
    UPDATE public.profiles
      SET is_suspended = false,
          suspended_by_tenant = false,
          suspension_reason = NULL,
          suspended_at = NULL,
          suspended_by = NULL,
          is_active = true,
          updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND suspended_by_tenant = true;
  ELSE
    UPDATE public.profiles
      SET is_suspended = true,
          suspended_by_tenant = true,
          suspension_reason = 'Company deactivated',
          suspended_at = now(),
          suspended_by = auth.uid(),
          is_active = false,
          updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND role IS DISTINCT FROM 'master'
      AND COALESCE(is_suspended, false) = false;
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_login_access(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_tenant_login_access(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_login_blocked()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = auth.uid()
      AND p.role IS DISTINCT FROM 'master'
      AND COALESCE(t.is_active, true) = false
  );
$$;

REVOKE ALL ON FUNCTION public.is_login_blocked() FROM public;
GRANT EXECUTE ON FUNCTION public.is_login_blocked() TO authenticated;
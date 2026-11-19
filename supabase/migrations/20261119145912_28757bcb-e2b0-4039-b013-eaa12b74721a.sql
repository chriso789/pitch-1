CREATE OR REPLACE FUNCTION public.can_edit_profile(_target_id uuid, _target_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _target_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'master'::app_role
          OR (p.role IN ('owner'::app_role, 'corporate'::app_role, 'office_admin'::app_role)
              AND p.tenant_id = _target_tenant_id)
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_edit_profile(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_profile(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users and admins can update profiles" ON public.profiles;
CREATE POLICY "Users and admins can update profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.can_edit_profile(id, tenant_id))
WITH CHECK (public.can_edit_profile(id, tenant_id));

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_role text;
  v_caller_is_dev boolean;
BEGIN
  -- Server-side code (service role, migrations) is trusted.
  IF coalesce(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT role::text, coalesce(is_developer, false)
    INTO v_caller_role, v_caller_is_dev
  FROM public.profiles WHERE id = auth.uid();

  IF v_caller_role = 'master' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Roles can only be changed through the role change action'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.can_manage_all_companies IS DISTINCT FROM OLD.can_manage_all_companies
     AND coalesce(NEW.can_manage_all_companies, false) THEN
    RAISE EXCEPTION 'Only the platform owner can grant access to all companies'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_developer IS DISTINCT FROM OLD.is_developer
     AND coalesce(NEW.is_developer, false) AND NOT v_caller_is_dev THEN
    RAISE EXCEPTION 'Only the platform owner can grant developer access'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id = auth.uid() AND (
       NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.is_suspended IS DISTINCT FROM OLD.is_suspended
    OR NEW.suspended_by_tenant IS DISTINCT FROM OLD.suspended_by_tenant
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
  ) THEN
    RAISE EXCEPTION 'You cannot change your own company or account status'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_privileged_columns ON public.profiles;
CREATE TRIGGER guard_profile_privileged_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileged_columns();
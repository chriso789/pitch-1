CREATE OR REPLACE FUNCTION public.locate_pipeline_entry_tenant(p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant_id uuid;
  v_tenant_name text;
  v_has_access boolean;
BEGIN
  SELECT pe.tenant_id INTO v_tenant_id
  FROM pipeline_entries pe
  WHERE pe.id = p_entry_id;

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM profiles WHERE id = auth.uid() AND tenant_id = v_tenant_id
    UNION
    SELECT 1 FROM user_company_access
      WHERE user_id = auth.uid() AND tenant_id = v_tenant_id AND is_active = true
    UNION
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master'
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT name INTO v_tenant_name FROM tenants WHERE id = v_tenant_id;

  RETURN jsonb_build_object(
    'found', true,
    'tenant_id', v_tenant_id,
    'tenant_name', v_tenant_name,
    'active_tenant_id', public.get_user_active_tenant_id()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.locate_pipeline_entry_tenant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locate_pipeline_entry_tenant(uuid) TO authenticated;
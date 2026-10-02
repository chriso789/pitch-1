CREATE OR REPLACE FUNCTION public.commercial_create_project(_tenant_id uuid, _name text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Your sign-in session expired. Please refresh the page and sign in again.'; END IF;
  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'No company selected.'; END IF;
  IF public.is_login_blocked() THEN RAISE EXCEPTION 'Your company account is deactivated.'; END IF;
  IF NOT public.commercial_can_access_tenant(_tenant_id) THEN RAISE EXCEPTION 'You do not have access to the selected company.'; END IF;
  INSERT INTO public.commercial_projects(tenant_id, name, metadata)
  VALUES (_tenant_id, COALESCE(NULLIF(_name,''),'Untitled'), COALESCE(_metadata,'{}'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.commercial_create_project(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_create_project(uuid,text,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.commercial_create_project(_tenant_id uuid, _name text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _t uuid := _tenant_id;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Your sign-in session expired. Please refresh the page and sign in again.'; END IF;
  IF public.is_login_blocked() THEN RAISE EXCEPTION 'Your company account is deactivated.'; END IF;
  IF _t IS NULL OR NOT public.commercial_can_access_tenant(_t) THEN
    _t := public.get_user_tenant_id();
  END IF;
  IF _t IS NULL OR NOT public.commercial_can_access_tenant(_t) THEN RAISE EXCEPTION 'You do not have access to the selected company.'; END IF;
  INSERT INTO public.commercial_projects(tenant_id, name, metadata)
  VALUES (_t, COALESCE(NULLIF(_name,''),'Untitled'), COALESCE(_metadata,'{}'::jsonb))
  RETURNING id INTO _id;
  RETURN _id;
END $$;
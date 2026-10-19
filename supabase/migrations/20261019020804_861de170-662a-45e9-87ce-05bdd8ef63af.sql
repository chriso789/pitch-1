REVOKE EXECUTE ON FUNCTION public.canvass_photo_tenant_allowed(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.canvass_photo_tenant_allowed(uuid) TO authenticated, service_role;
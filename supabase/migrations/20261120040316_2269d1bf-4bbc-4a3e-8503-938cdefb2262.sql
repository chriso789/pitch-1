REVOKE ALL ON FUNCTION public.caller_belongs_to_tenant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caller_belongs_to_tenant(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.pdf_compare_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pdf_compare_member(uuid) TO authenticated, service_role;
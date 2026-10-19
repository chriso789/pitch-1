ALTER FUNCTION public.canvass_training_reference_locked(text) SET SCHEMA photo_training_internal;
CREATE FUNCTION public.canvass_training_reference_locked(path text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT photo_training_internal.canvass_training_reference_locked(path) $$;
REVOKE ALL ON FUNCTION public.canvass_training_reference_locked(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.canvass_training_reference_locked(text) TO authenticated,service_role;
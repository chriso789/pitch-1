CREATE SCHEMA IF NOT EXISTS photo_training_internal; REVOKE ALL ON SCHEMA photo_training_internal FROM PUBLIC,anon; GRANT USAGE ON SCHEMA photo_training_internal TO authenticated,service_role;
DO $$ DECLARE f record; args text; wrapper text; BEGIN FOR f IN SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) ident,pg_get_function_arguments(p.oid) declarations,pg_get_function_result(p.oid) result,p.proargnames FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('photo_training_access','photo_training_original_add','photo_training_label_save','photo_training_label_review','photo_training_dataset_create','photo_damage_model_register','photo_damage_model_review','photo_damage_model_activate') LOOP
SELECT string_agg(quote_ident(n),',') INTO args FROM unnest(f.proargnames) n;
EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA photo_training_internal',f.proname,f.ident);
wrapper:=format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql SECURITY INVOKER SET search_path=public AS %L',f.proname,f.declarations,f.result,format('SELECT photo_training_internal.%I(%s)',f.proname,args)); EXECUTE wrapper;
EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon',f.proname,f.ident);
EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated,service_role',f.proname,f.ident);
END LOOP; END $$;
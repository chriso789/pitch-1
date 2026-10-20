CREATE SCHEMA IF NOT EXISTS internal;
REVOKE ALL ON SCHEMA internal FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.platform_photo_inventory(boolean) FROM authenticated;
ALTER FUNCTION public.platform_photo_inventory(boolean) SET SCHEMA internal;
CREATE OR REPLACE FUNCTION public.platform_photo_inventory_service(_actor uuid,_batch boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,internal AS $$
DECLARE r jsonb;
BEGIN
 IF current_user <> 'service_role' OR NOT public.has_training_access(_actor,'developer') THEN RAISE EXCEPTION 'Platform developer access required'; END IF;
 PERFORM set_config('request.jwt.claim.sub',_actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','service_role')::text,true);
 SELECT internal.platform_photo_inventory(_batch) INTO r;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.platform_photo_inventory_service(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_photo_inventory_service(uuid,boolean) TO service_role;
GRANT USAGE ON SCHEMA internal TO service_role;
GRANT EXECUTE ON FUNCTION internal.platform_photo_inventory(boolean) TO service_role;
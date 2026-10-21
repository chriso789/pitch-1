-- Read-only privilege and terminal-auth assertions; no customer rows changed.
DO $$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['photo_preparation_create(integer)','photo_preparation_manage(uuid,text)','photo_shared_reference_publish()','photo_shared_reference_inference()','photo_preparation_claim()','photo_preparation_finish(uuid,uuid,jsonb)'] LOOP
  IF has_function_privilege('anon','public.'||name,'EXECUTE') THEN RAISE EXCEPTION 'Anonymous execution leaked: %',name; END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.photo_preparation_claim()','EXECUTE') OR has_function_privilege('authenticated','public.photo_preparation_finish(uuid,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Worker execution leaked to application users'; END IF;
 IF has_table_privilege('authenticated','public.photo_reference_examples','SELECT') THEN RAISE EXCEPTION 'Private shared provenance is readable'; END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{}',true);
 BEGIN
  PERFORM public.photo_preparation_create(10);
  RAISE EXCEPTION 'Unsigned job creation succeeded';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Platform developer access required' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.photo_shared_reference_publish();
  RAISE EXCEPTION 'Unsigned reference publication succeeded';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Platform developer access required' THEN RAISE; END IF;
 END;
END $$;
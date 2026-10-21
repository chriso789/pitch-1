REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.photo_preparation_jobs,public.photo_preparation_items FROM authenticated,anon;
REVOKE ALL ON public.photo_preparation_jobs,public.photo_preparation_items FROM anon;
CREATE OR REPLACE FUNCTION internal.photo_shared_reference_inference() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign-in required'; END IF;
 SELECT jsonb_build_object('version',coalesce(max(e.library_version),0),'embeddingModelId','dinov2-small','examples',coalesce(jsonb_agg(jsonb_build_object('id',e.id,'cls',e.cls,'embedding',e.embedding,'libraryVersion',e.library_version)),'[]'::jsonb)) INTO r FROM public.photo_reference_examples e JOIN public.photo_reference_candidates c ON c.id=e.candidate_id AND c.tenant_id=e.tenant_id JOIN public.customer_photos p ON p.id=c.source_photo_id AND p.tenant_id=c.tenant_id WHERE public.photo_shared_consent(e.tenant_id) AND c.review_status='approved' AND c.approved_by=e.approved_by AND c.labeled_by=e.labeled_by AND c.approved_by<>c.labeled_by AND c.condition IS DISTINCT FROM 'uncertain' AND e.embedding_model_id='dinov2-small' AND c.embedding_model_id=e.embedding_model_id AND c.embedding=e.embedding AND c.cls=e.cls AND jsonb_array_length(e.embedding)=384; RETURN r;
END $$;
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
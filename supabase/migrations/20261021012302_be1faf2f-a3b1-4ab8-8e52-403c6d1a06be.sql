CREATE TABLE public.photo_browser_tests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid NOT NULL, selection jsonb NOT NULL, results jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.photo_browser_tests TO service_role;
ALTER TABLE public.photo_browser_tests ENABLE ROW LEVEL SECURITY;
CREATE INDEX photo_browser_tests_actor_time ON public.photo_browser_tests(created_by,created_at DESC);
CREATE OR REPLACE FUNCTION public.photo_browser_result_save(_actor uuid,_test uuid,_photo uuid,_result jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE b public.photo_browser_tests; p jsonb; consent public.photo_training_contributions; saved jsonb; r jsonb; existing_count integer; st text;
BEGIN
 IF current_user <> 'service_role' OR NOT public.has_training_access(_actor,'developer') THEN RAISE EXCEPTION 'Platform developer access required'; END IF;
 SELECT * INTO b FROM public.photo_browser_tests WHERE id=_test AND created_by=_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Test unavailable'; END IF;
 SELECT value INTO p FROM jsonb_array_elements(b.selection) WHERE value->>'id'=_photo::text;
 IF p IS NULL THEN RAISE EXCEPTION 'Photo outside test'; END IF;
 SELECT * INTO consent FROM public.photo_training_contributions WHERE tenant_id=(p->>'tenantId')::uuid FOR SHARE;
 IF consent.status IS DISTINCT FROM 'opted_in' OR consent.terms_version IS DISTINCT FROM 'pitch-photo-training-v1' OR consent.authorized_by IS NULL OR consent.authorized_at IS NULL OR consent.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'Current consent required'; END IF;
 IF b.results ? _photo::text THEN RETURN b.results->_photo::text; END IF;
 IF jsonb_array_length(b.selection)>10 OR _result->>'status' NOT IN ('completed','no_useful_regions','failed','unassessable','duplicate','access_unavailable') OR jsonb_typeof(_result->'outlines') IS DISTINCT FROM 'array' OR jsonb_array_length(_result->'outlines')>1000 THEN RAISE EXCEPTION 'Invalid result'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended((p->>'tenantId')||':'||_photo::text,0));
 SELECT count(*) INTO existing_count FROM public.photo_region_proposals WHERE tenant_id=(p->>'tenantId')::uuid AND source_photo_id=_photo;
 IF existing_count=0 AND _result->>'status'='completed' THEN
  FOR r IN SELECT value FROM jsonb_array_elements(_result->'outlines') LOOP
   INSERT INTO public.photo_region_proposals(tenant_id,source_photo_id,property_key,polygon,group_index,suggestion,status,segmenter_model,embedder_model,timings_ms,created_by)
   VALUES((p->>'tenantId')::uuid,_photo,p->>'propertyKey',r->'polygon',coalesce((r->>'group')::integer,-1),jsonb_build_object('kind','unknown','cls',NULL),'unverified',_result->>'segmenter',_result->>'embedder',coalesce(_result->'timingsMs','{}'::jsonb),_actor);
  END LOOP;
 END IF;
 saved:=_result||jsonb_build_object('photoId',_photo,'photo',(p->>'photo')::integer,'testId',_test,'savedAt',now(),'saveStatus','verified','existingOutlinesPreserved',existing_count>0);
 st:=CASE WHEN _result->>'status' IN ('duplicate','access_unavailable') THEN 'unassessable' ELSE _result->>'status' END;
 INSERT INTO public.photo_proposal_runs(tenant_id,source_photo_id,status,width_px,height_px,region_count,invalid_region_count,duration_ms,error,segmenter_model,created_by)
 VALUES((p->>'tenantId')::uuid,_photo,st,(_result->>'width')::integer,(_result->>'height')::integer,jsonb_array_length(_result->'outlines'),(_result->>'invalidRegions')::integer,(_result->>'durationMs')::integer,_result->>'error',_result->>'segmenter',_actor);
 UPDATE public.photo_browser_tests SET results=results||jsonb_build_object(_photo::text,saved),updated_at=now() WHERE id=_test;
 INSERT INTO public.platform_training_access_log(actor_id,action) VALUES(_actor,'browser_photo_result_saved');
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.photo_browser_result_save(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.photo_browser_result_save(uuid,uuid,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.photo_preparation_create(_limit integer DEFAULT 10) RETURNS uuid LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF _limit IS NULL OR _limit<1 OR _limit>10 THEN RAISE EXCEPTION 'First ten photos require visual acceptance before larger batches'; END IF;
 RETURN internal.photo_preparation_create(_limit);
END $$;
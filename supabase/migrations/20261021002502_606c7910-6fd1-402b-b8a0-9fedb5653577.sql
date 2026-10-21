CREATE TABLE public.photo_preparation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid NOT NULL REFERENCES auth.users(id), status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','cancelled','blocked')), item_limit integer NOT NULL CHECK(item_limit BETWEEN 1 AND 100), blocked_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.photo_preparation_jobs TO authenticated;
GRANT ALL ON public.photo_preparation_jobs TO service_role;
ALTER TABLE public.photo_preparation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY preparation_developer_read ON public.photo_preparation_jobs FOR SELECT TO authenticated USING(public.has_training_access(auth.uid(),'developer'));
CREATE TABLE public.photo_preparation_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.photo_preparation_jobs(id), tenant_id uuid NOT NULL REFERENCES public.tenants(id), photo_id uuid NOT NULL REFERENCES public.customer_photos(id), property_key text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','retry_wait','completed','no_useful_regions','unassessable','duplicate','failed','consent_revoked','cancelled')), attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(), original_sha256 text, region_count integer NOT NULL DEFAULT 0, duration_ms integer, error text, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id,photo_id)
);
GRANT SELECT ON public.photo_preparation_items TO authenticated;
GRANT ALL ON public.photo_preparation_items TO service_role;
ALTER TABLE public.photo_preparation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY preparation_item_developer_read ON public.photo_preparation_items FOR SELECT TO authenticated USING(public.has_training_access(auth.uid(),'developer'));
CREATE INDEX preparation_item_claim ON public.photo_preparation_items(status,next_attempt_at,lease_until);
CREATE INDEX preparation_item_scope ON public.photo_preparation_items(tenant_id,photo_id);
CREATE OR REPLACE FUNCTION public.photo_preparation_touch() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$;
CREATE TRIGGER preparation_job_touch BEFORE UPDATE ON public.photo_preparation_jobs FOR EACH ROW EXECUTE FUNCTION public.photo_preparation_touch();
CREATE TRIGGER preparation_item_touch BEFORE UPDATE ON public.photo_preparation_items FOR EACH ROW EXECUTE FUNCTION public.photo_preparation_touch();
CREATE OR REPLACE FUNCTION public.photo_shared_consent(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.photo_training_contributions WHERE tenant_id=_tenant AND status='opted_in' AND terms_version='pitch-photo-training-v1' AND authorized_by IS NOT NULL AND authorized_at IS NOT NULL AND withdrawn_at IS NULL) $$;
REVOKE ALL ON FUNCTION public.photo_shared_consent(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.photo_shared_consent(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.photo_preparation_create(_limit integer DEFAULT 10) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_training_access(auth.uid(),'developer') THEN RAISE EXCEPTION 'Platform developer access required'; END IF;
 IF _limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Photo limit must be between 1 and 100'; END IF;
 PERFORM pg_advisory_xact_lock(884210);
 IF EXISTS(SELECT 1 FROM public.photo_preparation_jobs WHERE status IN ('queued','running','blocked')) THEN RAISE EXCEPTION 'Finish or cancel the current preparation job first'; END IF;
 INSERT INTO public.photo_preparation_jobs(created_by,item_limit) VALUES(auth.uid(),_limit) RETURNING id INTO j;
 WITH eligible AS (SELECT p.id,p.tenant_id,coalesce('lead:'||p.lead_id::text,'project:'||p.project_id::text,'contact:'||p.contact_id::text) property_key FROM public.customer_photos p WHERE public.photo_shared_consent(p.tenant_id) AND (p.mime_type IS NULL OR p.mime_type LIKE 'image/%') AND NOT EXISTS(SELECT 1 FROM public.photo_preparation_items i WHERE i.photo_id=p.id AND i.tenant_id=p.tenant_id AND i.status IN ('completed','no_useful_regions','unassessable','duplicate'))), ranked AS (SELECT *,row_number() OVER(PARTITION BY tenant_id,property_key ORDER BY id) r FROM eligible WHERE property_key IS NOT NULL)
 INSERT INTO public.photo_preparation_items(job_id,tenant_id,photo_id,property_key) SELECT j,tenant_id,id,property_key FROM ranked ORDER BY r,tenant_id,property_key,id LIMIT _limit;
 IF NOT FOUND THEN RAISE EXCEPTION 'No authorized unprocessed photos are available'; END IF;
 INSERT INTO public.platform_training_access_log(actor_id,action) VALUES(auth.uid(),'photo_preparation_create'); RETURN j;
END $$;
REVOKE ALL ON FUNCTION public.photo_preparation_create(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.photo_preparation_create(integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.photo_preparation_manage(_job uuid,_action text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_training_access(auth.uid(),'developer') THEN RAISE EXCEPTION 'Platform developer access required'; END IF;
 PERFORM 1 FROM public.photo_preparation_jobs WHERE id=_job FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
 IF _action='cancel' THEN
 UPDATE public.photo_preparation_jobs SET status='cancelled',blocked_reason=NULL WHERE id=_job AND status IN ('queued','running','blocked');
 UPDATE public.photo_preparation_items SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE job_id=_job AND status IN ('pending','running','retry_wait');
 ELSIF _action='resume' THEN
 UPDATE public.photo_preparation_jobs SET status='queued',blocked_reason=NULL WHERE id=_job AND status='blocked';
 ELSE RAISE EXCEPTION 'Invalid job action'; END IF;
 INSERT INTO public.platform_training_access_log(actor_id,action) VALUES(auth.uid(),'photo_preparation_'||_action);
END $$;
REVOKE ALL ON FUNCTION public.photo_preparation_manage(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.photo_preparation_manage(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.photo_preparation_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE i public.photo_preparation_items%ROWTYPE; j public.photo_preparation_jobs%ROWTYPE; token uuid:=gen_random_uuid();
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Internal worker access required'; END IF;
 PERFORM pg_advisory_xact_lock(884210);
 UPDATE public.photo_preparation_items SET status=CASE WHEN attempts<3 THEN 'retry_wait' ELSE 'failed' END,error='Worker lease expired',lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '60 seconds' WHERE status='running' AND lease_until<now();
 IF EXISTS(SELECT 1 FROM public.photo_preparation_items WHERE status='running' AND lease_until>=now()) THEN RETURN NULL; END IF;
 FOR j IN SELECT * FROM public.photo_preparation_jobs WHERE status IN ('queued','running') ORDER BY created_at FOR UPDATE LOOP
 IF NOT public.has_training_access(j.created_by,'developer') THEN UPDATE public.photo_preparation_jobs SET status='blocked',blocked_reason='Creator no longer has developer access' WHERE id=j.id; CONTINUE; END IF;
 UPDATE public.photo_preparation_items SET status='consent_revoked',error='Current company consent is required' WHERE job_id=j.id AND status IN ('pending','retry_wait') AND NOT public.photo_shared_consent(tenant_id);
 SELECT * INTO i FROM public.photo_preparation_items WHERE job_id=j.id AND status IN ('pending','retry_wait') AND attempts<3 AND next_attempt_at<=now() ORDER BY created_at,id LIMIT 1 FOR UPDATE;
 IF FOUND THEN
 UPDATE public.photo_preparation_items SET status='running',attempts=attempts+1,lease_token=token,lease_until=now()+interval '10 minutes' WHERE id=i.id;
 UPDATE public.photo_preparation_jobs SET status='running' WHERE id=j.id;
 INSERT INTO public.platform_training_access_log(actor_id,action) VALUES(j.created_by,'photo_preparation_claim');
 RETURN jsonb_build_object('itemId',i.id,'jobId',j.id,'tenantId',i.tenant_id,'photoId',i.photo_id,'propertyKey',i.property_key,'leaseToken',token,'fileUrl',(SELECT file_url FROM public.customer_photos WHERE id=i.photo_id AND tenant_id=i.tenant_id));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.photo_preparation_items WHERE job_id=j.id AND status IN ('pending','running','retry_wait')) THEN UPDATE public.photo_preparation_jobs SET status='completed' WHERE id=j.id; END IF;
 END LOOP; RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.photo_preparation_claim() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.photo_preparation_claim() TO service_role;
ALTER TABLE public.photo_region_proposals ADD COLUMN embedding jsonb, ADD COLUMN preparation_item_id uuid REFERENCES public.photo_preparation_items(id), ADD COLUMN original_sha256 text;
CREATE UNIQUE INDEX preparation_region_identity ON public.photo_region_proposals(preparation_item_id,group_index) WHERE preparation_item_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.photo_preparation_finish(_item uuid,_lease uuid,_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE i public.photo_preparation_items%ROWTYPE; j public.photo_preparation_jobs%ROWTYPE; s text; q jsonb; r jsonb; h text;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Internal worker access required'; END IF;
 SELECT * INTO i FROM public.photo_preparation_items WHERE id=_item FOR UPDATE;
 IF NOT FOUND OR i.status<>'running' OR i.lease_token IS DISTINCT FROM _lease OR i.lease_until<now() THEN RAISE EXCEPTION 'Lease is no longer valid'; END IF;
 SELECT * INTO j FROM public.photo_preparation_jobs WHERE id=i.job_id FOR UPDATE;
 IF j.status NOT IN ('queued','running') THEN RAISE EXCEPTION 'Job is not running'; END IF;
 IF NOT public.has_training_access(j.created_by,'developer') OR NOT public.photo_shared_consent(i.tenant_id) THEN
 UPDATE public.photo_preparation_items SET status='consent_revoked',lease_token=NULL,lease_until=NULL,error='Authorization withdrawn before completion' WHERE id=i.id; RETURN; END IF;
 s:=_result->>'status';
 IF s NOT IN ('completed','no_useful_regions','unassessable','failed','blocked') THEN RAISE EXCEPTION 'Invalid processing status'; END IF;
 IF s IN ('failed','blocked') THEN
 UPDATE public.photo_preparation_items SET status=CASE WHEN s='blocked' THEN 'pending' WHEN _result->>'retryable'='true' AND attempts<3 THEN 'retry_wait' ELSE 'failed' END, next_attempt_at=now()+make_interval(secs=>60*power(2,i.attempts)::integer),lease_token=NULL,lease_until=NULL,error=left(coalesce(_result->>'error','Photo processing failed'),300) WHERE id=i.id;
 IF s='blocked' THEN UPDATE public.photo_preparation_jobs SET status='blocked',blocked_reason=left(coalesce(_result->>'error','Worker configuration required'),300) WHERE id=j.id; END IF; RETURN;
 END IF;
 q:=_result->'quality'; h:=_result->>'sha256';
 IF h IS NULL OR h !~ '^[a-f0-9]{64}$' OR jsonb_typeof(q->'assessable')<>'boolean' OR jsonb_typeof(q->'sharpness')<>'number' OR jsonb_typeof(q->'brightness')<>'number' OR (q->>'dhash') !~ '^[a-f0-9]{16}$' THEN RAISE EXCEPTION 'Invalid quality evidence'; END IF;
 IF jsonb_typeof(_result->'regions')<>'array' OR jsonb_array_length(_result->'regions')>100 THEN RAISE EXCEPTION 'Invalid region payload'; END IF;
 IF s IN ('completed','no_useful_regions') AND (q->>'assessable'<>'true' OR _result->>'segmenter'<>'sam2.1-hiera-tiny' OR _result->>'embedder'<>'dinov2-small') THEN RAISE EXCEPTION 'Both models and assessable quality required'; END IF;
 IF EXISTS(SELECT 1 FROM public.photo_preparation_items p WHERE p.tenant_id=i.tenant_id AND p.property_key=i.property_key AND p.original_sha256=h AND p.id<>i.id AND p.status IN ('completed','no_useful_regions','unassessable','duplicate')) THEN s:='duplicate'; END IF;
 INSERT INTO public.photo_triage_results(photo_id,tenant_id,property_key,dhash,sharpness,brightness,assessable,issues,processing_ms,processed_by) VALUES(i.photo_id,i.tenant_id,i.property_key,q->>'dhash',(q->>'sharpness')::real,(q->>'brightness')::real,(q->>'assessable')::boolean,ARRAY(SELECT left(value,200) FROM jsonb_array_elements_text(coalesce(q->'issues','[]'::jsonb))),least(2147483647,greatest(0,(_result->>'durationMs')::integer)),j.created_by) ON CONFLICT(photo_id) DO UPDATE SET dhash=EXCLUDED.dhash,sharpness=EXCLUDED.sharpness,brightness=EXCLUDED.brightness,assessable=EXCLUDED.assessable,issues=EXCLUDED.issues,processing_ms=EXCLUDED.processing_ms,processed_by=EXCLUDED.processed_by,processed_at=now() WHERE photo_triage_results.tenant_id=EXCLUDED.tenant_id;
 IF s='completed' THEN
 IF jsonb_array_length(_result->'regions')=0 THEN RAISE EXCEPTION 'Completed requires useful outlines'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(_result->'regions') LOOP
 IF jsonb_typeof(r->'polygon')<>'array' OR jsonb_array_length(r->'polygon') NOT BETWEEN 3 AND 2048 OR jsonb_typeof(r->'embedding')<>'array' OR jsonb_array_length(r->'embedding')<>384 THEN RAISE EXCEPTION 'Invalid region geometry or embedding'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'polygon') p WHERE jsonb_typeof(p->'x')<>'number' OR jsonb_typeof(p->'y')<>'number' OR (p->>'x')::float NOT BETWEEN 0 AND 1 OR (p->>'y')::float NOT BETWEEN 0 AND 1) THEN RAISE EXCEPTION 'Invalid normalized polygon'; END IF;
 INSERT INTO public.photo_region_proposals(tenant_id,source_photo_id,property_key,polygon,embedding,group_index,suggestion,status,segmenter_model,embedder_model,timings_ms,created_by,preparation_item_id,original_sha256) VALUES(i.tenant_id,i.photo_id,i.property_key,r->'polygon',r->'embedding',(_result->'regions')::text IS NULL::integer,'{}'::jsonb,'unverified',_result->>'segmenter',_result->>'embedder',_result->'timingsMs',j.created_by,i.id,h);
 END LOOP;
 END IF;
 INSERT INTO public.photo_proposal_runs(tenant_id,source_photo_id,status,width_px,height_px,region_count,invalid_region_count,duration_ms,segmenter_model,created_by) VALUES(i.tenant_id,i.photo_id,CASE WHEN s='duplicate' THEN 'no_useful_regions' ELSE s END,(_result->>'width')::integer,(_result->>'height')::integer,CASE WHEN s='completed' THEN jsonb_array_length(_result->'regions') ELSE 0 END,coalesce((_result->>'invalidRegions')::integer,0),(_result->>'durationMs')::integer,_result->>'segmenter',j.created_by);
 UPDATE public.photo_preparation_items SET status=s,original_sha256=h,result=_result-'regions',region_count=CASE WHEN s='completed' THEN jsonb_array_length(_result->'regions') ELSE 0 END,duration_ms=(_result->>'durationMs')::integer,lease_token=NULL,lease_until=NULL,error=NULL WHERE id=i.id;
 INSERT INTO public.platform_training_access_log(actor_id,action) VALUES(j.created_by,'photo_preparation_finish');
 IF NOT EXISTS(SELECT 1 FROM public.photo_preparation_items WHERE job_id=j.id AND status IN ('pending','running','retry_wait')) THEN UPDATE public.photo_preparation_jobs SET status='completed' WHERE id=j.id; END IF;
END $$;
REVOKE ALL ON FUNCTION public.photo_preparation_finish(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.photo_preparation_finish(uuid,uuid,jsonb) TO service_role;
ALTER TABLE public.photo_reference_examples ADD COLUMN candidate_id uuid REFERENCES public.photo_reference_candidates(id), ADD COLUMN tenant_id uuid REFERENCES public.tenants(id);
CREATE UNIQUE INDEX shared_reference_candidate ON public.photo_reference_examples(candidate_id) WHERE candidate_id IS NOT NULL;
REVOKE SELECT,INSERT,UPDATE,DELETE ON public.photo_reference_examples FROM authenticated;
CREATE OR REPLACE FUNCTION public.photo_shared_reference_publish() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v integer; n integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_training_access(auth.uid(),'developer') THEN RAISE EXCEPTION 'Platform developer access required'; END IF;
 PERFORM pg_advisory_xact_lock(884211);
 SELECT coalesce(max(library_version),0)+1 INTO v FROM public.photo_reference_examples;
 INSERT INTO public.photo_reference_examples(cls,embedding,embedding_model_id,library_version,source_photo_id,source_region_id,labeled_by,approved_by,candidate_id,tenant_id)
 SELECT c.cls,c.embedding,c.embedding_model_id,v,c.source_photo_id::text,c.id::text,c.labeled_by,c.approved_by,c.id,c.tenant_id FROM public.photo_reference_candidates c JOIN public.customer_photos p ON p.id=c.source_photo_id AND p.tenant_id=c.tenant_id WHERE c.review_status='approved' AND c.approved_by IS NOT NULL AND c.approved_by<>c.labeled_by AND public.photo_shared_consent(c.tenant_id) AND c.condition IS DISTINCT FROM 'uncertain' AND c.embedding_model_id='dinov2-small' AND jsonb_array_length(c.embedding)=384 AND NOT EXISTS(SELECT 1 FROM public.photo_reference_examples e WHERE e.candidate_id=c.id);
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO public.platform_training_access_log(actor_id,action) VALUES(auth.uid(),'shared_reference_publish'); RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.photo_shared_reference_publish() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.photo_shared_reference_publish() TO authenticated;
CREATE OR REPLACE FUNCTION public.photo_shared_reference_inference() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign-in required'; END IF;
 SELECT jsonb_build_object('version',coalesce(max(e.library_version),0),'embeddingModelId','dinov2-small','examples',coalesce(jsonb_agg(jsonb_build_object('id',e.id,'cls',e.cls,'embedding',e.embedding,'libraryVersion',e.library_version)),'[]'::jsonb)) INTO r FROM public.photo_reference_examples e JOIN public.photo_reference_candidates c ON c.id=e.candidate_id AND c.tenant_id=e.tenant_id JOIN public.customer_photos p ON p.id=c.source_photo_id AND p.tenant_id=c.tenant_id WHERE public.photo_shared_consent(e.tenant_id) AND c.review_status='approved' AND c.approved_by=e.approved_by AND c.labeled_by=e.labeled_by AND c.approved_by<>c.labeled_by AND c.condition IS DISTINCT FROM 'uncertain' AND e.embedding_model_id='dinov2-small'; RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.photo_shared_reference_inference() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.photo_shared_reference_inference() TO authenticated;
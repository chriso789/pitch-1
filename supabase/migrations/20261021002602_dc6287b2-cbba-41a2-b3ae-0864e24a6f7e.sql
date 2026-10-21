ALTER FUNCTION public.photo_preparation_create(integer) SET SCHEMA internal;
ALTER FUNCTION public.photo_preparation_manage(uuid,text) SET SCHEMA internal;
ALTER FUNCTION public.photo_shared_reference_publish() SET SCHEMA internal;
ALTER FUNCTION public.photo_shared_reference_inference() SET SCHEMA internal;
GRANT USAGE ON SCHEMA internal TO authenticated;
REVOKE ALL ON FUNCTION internal.photo_preparation_create(integer),internal.photo_preparation_manage(uuid,text),internal.photo_shared_reference_publish(),internal.photo_shared_reference_inference() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION internal.photo_preparation_create(integer),internal.photo_preparation_manage(uuid,text),internal.photo_shared_reference_publish(),internal.photo_shared_reference_inference() TO authenticated;
CREATE OR REPLACE FUNCTION public.photo_preparation_create(_limit integer DEFAULT 10) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT internal.photo_preparation_create(_limit) $$;
CREATE OR REPLACE FUNCTION public.photo_preparation_manage(_job uuid,_action text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT internal.photo_preparation_manage(_job,_action) $$;
CREATE OR REPLACE FUNCTION public.photo_shared_reference_publish() RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT internal.photo_shared_reference_publish() $$;
CREATE OR REPLACE FUNCTION public.photo_shared_reference_inference() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT internal.photo_shared_reference_inference() $$;
REVOKE ALL ON FUNCTION public.photo_preparation_create(integer),public.photo_preparation_manage(uuid,text),public.photo_shared_reference_publish(),public.photo_shared_reference_inference() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.photo_preparation_create(integer),public.photo_preparation_manage(uuid,text),public.photo_shared_reference_publish(),public.photo_shared_reference_inference() TO authenticated;
CREATE OR REPLACE FUNCTION public.photo_preparation_finish(_item uuid,_lease uuid,_result jsonb) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE i public.photo_preparation_items%ROWTYPE; j public.photo_preparation_jobs%ROWTYPE; s text; q jsonb; r jsonb; h text; idx integer:=0; area float; jid uuid;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'Internal worker access required'; END IF;
 SELECT job_id INTO jid FROM public.photo_preparation_items WHERE id=_item;
 SELECT * INTO j FROM public.photo_preparation_jobs WHERE id=jid FOR UPDATE;
 SELECT * INTO i FROM public.photo_preparation_items WHERE id=_item FOR UPDATE;
 IF NOT FOUND OR i.status<>'running' OR i.lease_token IS DISTINCT FROM _lease OR i.lease_until<now() THEN RAISE EXCEPTION 'Lease is no longer valid'; END IF;
 IF j.status NOT IN ('queued','running') THEN RAISE EXCEPTION 'Job is not running'; END IF;
 IF NOT public.has_training_access(j.created_by,'developer') OR NOT public.photo_shared_consent(i.tenant_id) THEN
 UPDATE public.photo_preparation_items SET status='consent_revoked',lease_token=NULL,lease_until=NULL,error='Authorization withdrawn before completion' WHERE id=i.id; RETURN; END IF;
 s:=_result->>'status';
 IF s IS NULL OR s NOT IN ('completed','no_useful_regions','unassessable','failed','blocked') THEN RAISE EXCEPTION 'Invalid processing status'; END IF;
 IF s IN ('failed','blocked') THEN
 UPDATE public.photo_preparation_items SET status=CASE WHEN s='blocked' THEN 'pending' WHEN _result->>'retryable'='true' AND attempts<3 THEN 'retry_wait' ELSE 'failed' END, attempts=CASE WHEN s='blocked' THEN greatest(0,attempts-1) ELSE attempts END, next_attempt_at=now()+make_interval(secs=>60*power(2,i.attempts)::integer),lease_token=NULL,lease_until=NULL,error=left(coalesce(_result->>'error','Photo processing failed'),300) WHERE id=i.id;
 IF s='blocked' THEN UPDATE public.photo_preparation_jobs SET status='blocked',blocked_reason=left(coalesce(_result->>'error','Worker configuration required'),300) WHERE id=j.id; END IF; RETURN;
 END IF;
 q:=_result->'quality'; h:=_result->>'sha256';
 IF h IS NULL OR h !~ '^[a-f0-9]{64}$' OR jsonb_typeof(q->'assessable') IS DISTINCT FROM 'boolean' OR jsonb_typeof(q->'sharpness') IS DISTINCT FROM 'number' OR jsonb_typeof(q->'brightness') IS DISTINCT FROM 'number' OR q->>'dhash' IS NULL OR (q->>'dhash') !~ '^[a-f0-9]{16}$' OR jsonb_typeof(q->'issues') IS DISTINCT FROM 'array' OR jsonb_typeof(_result->'durationMs') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid quality evidence'; END IF;
 IF jsonb_typeof(_result->'regions') IS DISTINCT FROM 'array' OR jsonb_array_length(_result->'regions')>100 THEN RAISE EXCEPTION 'Invalid region payload'; END IF;
 IF s IN ('completed','no_useful_regions') AND (q->>'assessable' IS DISTINCT FROM 'true' OR _result->>'segmenter' IS DISTINCT FROM 'sam2.1-hiera-tiny' OR _result->>'embedder' IS DISTINCT FROM 'dinov2-small') THEN RAISE EXCEPTION 'Both models and assessable quality required'; END IF;
 IF s IN ('unassessable','no_useful_regions') AND jsonb_array_length(_result->'regions')<>0 THEN RAISE EXCEPTION 'Status requires zero saved regions'; END IF;
 IF s='unassessable' AND q->>'assessable'<>'false' THEN RAISE EXCEPTION 'Unassessable requires failed quality'; END IF;
 IF EXISTS(SELECT 1 FROM public.photo_preparation_items p WHERE p.tenant_id=i.tenant_id AND p.property_key=i.property_key AND p.original_sha256=h AND p.id<>i.id AND p.status IN ('completed','no_useful_regions','unassessable','duplicate')) OR EXISTS(SELECT 1 FROM public.photo_triage_results t WHERE t.tenant_id=i.tenant_id AND t.property_key=i.property_key AND t.photo_id<>i.photo_id AND t.dhash=q->>'dhash' AND t.assessable=true) THEN s:='duplicate'; END IF;
 INSERT INTO public.photo_triage_results(photo_id,tenant_id,property_key,dhash,sharpness,brightness,assessable,issues,processing_ms,processed_by) VALUES(i.photo_id,i.tenant_id,i.property_key,q->>'dhash',(q->>'sharpness')::real,(q->>'brightness')::real,(q->>'assessable')::boolean,ARRAY(SELECT left(value,200) FROM jsonb_array_elements_text(q->'issues')),least(2147483647,greatest(0,(_result->>'durationMs')::integer)),j.created_by) ON CONFLICT(photo_id) DO UPDATE SET dhash=EXCLUDED.dhash,sharpness=EXCLUDED.sharpness,brightness=EXCLUDED.brightness,assessable=EXCLUDED.assessable,issues=EXCLUDED.issues,processing_ms=EXCLUDED.processing_ms,processed_by=EXCLUDED.processed_by,processed_at=now() WHERE photo_triage_results.tenant_id=EXCLUDED.tenant_id;
 IF s='completed' THEN
 IF jsonb_array_length(_result->'regions')=0 THEN RAISE EXCEPTION 'Completed requires useful outlines'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(_result->'regions') LOOP
 IF jsonb_typeof(r->'polygon') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'polygon') NOT BETWEEN 3 AND 2048 OR jsonb_typeof(r->'embedding') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'embedding')<>384 THEN RAISE EXCEPTION 'Invalid region geometry or embedding'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'embedding') e WHERE jsonb_typeof(e)<>'number') OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'polygon') p WHERE jsonb_typeof(p->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'y') IS DISTINCT FROM 'number' OR (p->>'x')::float NOT BETWEEN 0 AND 1 OR (p->>'y')::float NOT BETWEEN 0 AND 1) THEN RAISE EXCEPTION 'Invalid region values'; END IF;
 WITH points AS (SELECT value p,ordinality n FROM jsonb_array_elements(r->'polygon') WITH ORDINALITY), edges AS(SELECT p,coalesce(lead(p) OVER(ORDER BY n),(SELECT p FROM points ORDER BY n LIMIT 1)) next FROM points) SELECT abs(sum((p->>'x')::float*(next->>'y')::float-(next->>'x')::float*(p->>'y')::float))/2 INTO area FROM edges;
 IF area<0.0005 THEN RAISE EXCEPTION 'Polygon has insufficient area'; END IF;
 INSERT INTO public.photo_region_proposals(tenant_id,source_photo_id,property_key,polygon,embedding,group_index,suggestion,status,segmenter_model,embedder_model,timings_ms,created_by,preparation_item_id,original_sha256) VALUES(i.tenant_id,i.photo_id,i.property_key,r->'polygon',r->'embedding',idx,jsonb_build_object('kind','unknown','cls',NULL),'unverified',_result->>'segmenter',_result->>'embedder',_result->'timingsMs',j.created_by,i.id,h); idx:=idx+1;
 END LOOP;
 END IF;
 INSERT INTO public.photo_proposal_runs(tenant_id,source_photo_id,status,width_px,height_px,region_count,invalid_region_count,duration_ms,segmenter_model,created_by) VALUES(i.tenant_id,i.photo_id,CASE WHEN s='duplicate' THEN 'no_useful_regions' ELSE s END,(_result->>'width')::integer,(_result->>'height')::integer,CASE WHEN s='completed' THEN jsonb_array_length(_result->'regions') ELSE 0 END,coalesce((_result->>'invalidRegions')::integer,0),(_result->>'durationMs')::integer,_result->>'segmenter',j.created_by);
 UPDATE public.photo_preparation_items SET status=s,original_sha256=h,result=_result-'regions',region_count=CASE WHEN s='completed' THEN jsonb_array_length(_result->'regions') ELSE 0 END,duration_ms=(_result->>'durationMs')::integer,lease_token=NULL,lease_until=NULL,error=NULL WHERE id=i.id;
 INSERT INTO public.platform_training_access_log(actor_id,action) VALUES(j.created_by,'photo_preparation_finish');
 IF NOT EXISTS(SELECT 1 FROM public.photo_preparation_items WHERE job_id=j.id AND status IN ('pending','running','retry_wait')) THEN UPDATE public.photo_preparation_jobs SET status='completed' WHERE id=j.id; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.platform_photo_inventory(_batch boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_training_access(auth.uid(),'developer') THEN RAISE EXCEPTION 'Platform developer access required'; END IF;
 INSERT INTO public.platform_training_access_log(actor_id,action) VALUES(auth.uid(),CASE WHEN _batch THEN 'shared_photo_batch' ELSE 'photo_inventory' END);
 WITH consent AS (SELECT tenant_id FROM public.photo_training_contributions WHERE status='opted_in' AND terms_version='pitch-photo-training-v1' AND authorized_by IS NOT NULL AND authorized_at IS NOT NULL AND withdrawn_at IS NULL),
 images AS (SELECT p.id,p.tenant_id,p.file_url,p.file_name,coalesce('lead:'||p.lead_id::text,'project:'||p.project_id::text,'contact:'||p.contact_id::text) property_key FROM public.customer_photos p WHERE p.mime_type IS NULL OR p.mime_type LIKE 'image/%'),
 eligible AS (SELECT i.* FROM images i JOIN consent c USING(tenant_id)),
 ranked AS (SELECT e.*,row_number() OVER(PARTITION BY tenant_id,property_key ORDER BY id) property_round FROM eligible e WHERE property_key IS NOT NULL),
 selected AS (SELECT * FROM ranked ORDER BY property_round,tenant_id,property_key,id LIMIT 100),
 approved AS (SELECT c.* FROM public.photo_reference_candidates c JOIN consent o USING(tenant_id) WHERE c.approved_by IS NOT NULL AND c.approved_by<>c.labeled_by AND c.review_status='approved'),
 latest AS (SELECT DISTINCT ON(p.tenant_id,p.source_photo_id) p.* FROM public.photo_proposal_runs p JOIN eligible e ON e.id=p.source_photo_id AND e.tenant_id=p.tenant_id ORDER BY p.tenant_id,p.source_photo_id,p.created_at DESC)
 SELECT jsonb_build_object(
 'customer_photos',(SELECT count(*) FROM images),
 'other_image_records',(SELECT count(*) FROM public.documents WHERE mime_type LIKE 'image/%')+(SELECT count(*) FROM public.project_photos WHERE mime_type LIKE 'image/%')+(SELECT count(*) FROM public.canvass_photos),
 'eligible_photos',(SELECT count(*) FROM eligible WHERE property_key IS NOT NULL),
 'contributing_companies',(SELECT count(DISTINCT tenant_id) FROM eligible WHERE property_key IS NOT NULL),
 'properties',(SELECT count(DISTINCT (tenant_id::text||':'||property_key)) FROM eligible WHERE property_key IS NOT NULL),
 'all_customer_properties',(SELECT count(DISTINCT (tenant_id::text||':'||property_key)) FROM images WHERE property_key IS NOT NULL),
 'companies_without_consent',(SELECT count(DISTINCT i.tenant_id) FROM images i WHERE NOT EXISTS(SELECT 1 FROM consent c WHERE c.tenant_id=i.tenant_id)),
 'unassigned_eligible_photos',(SELECT count(*) FROM eligible WHERE property_key IS NULL),
 'processed_photos',(SELECT count(*) FROM latest WHERE status IN ('completed','no_useful_regions')),
 'candidate_regions',(SELECT count(*) FROM public.photo_region_proposals p JOIN eligible e ON e.id=p.source_photo_id AND e.tenant_id=p.tenant_id WHERE p.status='unverified'),
 'failures',coalesce((SELECT jsonb_agg(jsonb_build_object('reason',reason,'photos',n)) FROM (SELECT coalesce(error,status) reason,count(*) n FROM latest WHERE status IN ('failed','unassessable') GROUP BY coalesce(error,status)) f),'[]'::jsonb),
 'approved_by_component',coalesce((SELECT jsonb_agg(jsonb_build_object('component',cls,'examples',n)) FROM(SELECT cls,count(*) n FROM approved GROUP BY cls) a),'[]'::jsonb),
 'recognition_result',NULL,
 'photos',CASE WHEN _batch THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'tenantId',tenant_id,'propertyKey',property_key,'fileUrl',file_url,'fileName',file_name)) FROM selected),'[]'::jsonb) ELSE '[]'::jsonb END
 ) INTO r;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.platform_photo_inventory(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.platform_photo_inventory(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_photo_inventory(boolean) TO service_role;
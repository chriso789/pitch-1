-- Zero-copy canvass intake; apply only after local staging tests.
ALTER TABLE public.photo_training_originals
  ADD COLUMN storage_bucket text NOT NULL DEFAULT 'photo-training-originals',
  ADD COLUMN source_kind text NOT NULL DEFAULT 'inspector_upload',
  ADD COLUMN source_photo_id uuid,
  ADD COLUMN source_metadata jsonb NOT NULL DEFAULT '{}';
CREATE INDEX training_canvass_source ON public.photo_training_originals(tenant_id,source_photo_id);

CREATE OR REPLACE FUNCTION public.photo_training_canvass_register(photo uuid, actor uuid, hash text, w integer, h integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cp public.canvass_photos; orig public.photo_training_originals; oid uuid;
BEGIN
  SELECT * INTO cp FROM public.canvass_photos WHERE id=photo FOR UPDATE;
  IF cp.id IS NULL OR actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.user_company_access WHERE user_id=actor AND tenant_id=cp.tenant_id AND is_active
  ) THEN RAISE EXCEPTION 'Company access denied'; END IF;
  IF cp.property_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.canvassiq_properties WHERE id=cp.property_id AND tenant_id=cp.tenant_id)
    OR hash IS NULL OR hash !~ '^[a-f0-9]{64}$' OR w IS NULL OR h IS NULL OR w<=0 OR h<=0
    OR split_part(cp.storage_path,'/',1)<>cp.tenant_id::text
    OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='canvass-photos' AND name=cp.storage_path AND metadata->>'mimetype' IN ('image/jpeg','image/png','image/webp'))
    THEN RAISE EXCEPTION 'Invalid original or property association'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(cp.tenant_id::text||hash,0));
  SELECT * INTO orig FROM public.photo_training_originals WHERE tenant_id=cp.tenant_id AND sha256=hash;
  IF orig.id IS NOT NULL THEN
    IF orig.property_id<>cp.property_id::text THEN RAISE EXCEPTION 'Duplicate image belongs to another property'; END IF;
    RETURN orig.id;
  END IF;
  INSERT INTO public.photo_training_originals(tenant_id,property_id,sha256,storage_path,file_name,width,height,uploaded_by,storage_bucket,source_kind,source_photo_id,source_metadata)
  VALUES(cp.tenant_id,cp.property_id::text,hash,cp.storage_path,split_part(cp.storage_path,'/',array_length(string_to_array(cp.storage_path,'/'),1)),w,h,coalesce(cp.uploaded_by,actor),'canvass-photos','live_canvass',cp.id,
    jsonb_build_object('companyId',cp.tenant_id,'propertyId',cp.property_id,'propertyAddress',cp.property_address,'latitude',cp.latitude,'longitude',cp.longitude,'capturedAt',cp.taken_at,'employeeId',cp.uploaded_by,'repObservation',cp.category,'repNotes',cp.notes,'roofType',null,'originalPhotoId',cp.id))
  RETURNING id INTO oid;
  INSERT INTO public.photo_training_events(tenant_id,actor_id,action,snapshot) VALUES(cp.tenant_id,actor,'canvass_candidate',jsonb_build_object('originalId',oid,'photoId',cp.id,'sha256',hash));
  RETURN oid;
END $$;
REVOKE ALL ON FUNCTION public.photo_training_canvass_register(uuid,uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.photo_training_canvass_register(uuid,uuid,text,integer,integer) TO service_role;

-- Existing dataset builder remains the approval boundary. Enrich only NEW snapshots,
-- never update immutable datasets. Canonical property splits already come from it.
CREATE OR REPLACE FUNCTION public.photo_training_dataset_sources()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE photos jsonb; classes jsonb;
BEGIN
  SELECT jsonb_agg(p || jsonb_build_object('storageBucket',o.storage_bucket,'sourceKind',o.source_kind,'sourcePhotoId',o.source_photo_id,'sourceMetadata',o.source_metadata)) INTO photos
  FROM jsonb_array_elements(NEW.manifest->'photos') p JOIN public.photo_training_originals o ON o.id=(p->>'photoId')::uuid AND o.tenant_id=NEW.tenant_id;
  IF jsonb_array_length(coalesce(photos,'[]'))<>jsonb_array_length(NEW.manifest->'photos') THEN RAISE EXCEPTION 'Missing company original'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(photos) p WHERE p->>'status'<>'approved' OR p->>'approvedBy' IS NULL OR p->>'approvedBy'=p->>'labeledBy') THEN RAISE EXCEPTION 'Independent approval required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(photos) p GROUP BY p->>'sha256' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate image'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(photos) p GROUP BY p->>'propertyId' HAVING count(DISTINCT NEW.manifest->'split'->>(p->>'photoId'))>1) THEN RAISE EXCEPTION 'Property partition leakage'; END IF;
  SELECT coalesce(jsonb_agg(c ORDER BY c),'[]') INTO classes FROM (
    SELECT DISTINCT r->>'cls' c FROM jsonb_array_elements(photos) p CROSS JOIN LATERAL jsonb_array_elements(p->'regions') r
    WHERE r->>'cls' NOT LIKE 'uncertain_%' AND r->>'cls' NOT LIKE 'not_assessable_%'
  ) q;
  NEW.manifest := NEW.manifest || jsonb_build_object('photos',photos,'classes',classes);
  RETURN NEW;
END $$;
CREATE TRIGGER training_dataset_sources BEFORE INSERT ON public.photo_training_datasets FOR EACH ROW EXECUTE FUNCTION public.photo_training_dataset_sources();
REVOKE ALL ON FUNCTION public.photo_training_dataset_sources() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.canvass_photo_reference_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP<>'INSERT' AND EXISTS(SELECT 1 FROM public.photo_training_originals WHERE tenant_id=OLD.tenant_id AND storage_bucket='canvass-photos' AND storage_path=OLD.storage_path) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Training evidence is immutable'; END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.property_id IS DISTINCT FROM OLD.property_id OR NEW.storage_path IS DISTINCT FROM OLD.storage_path OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR NEW.taken_at IS DISTINCT FROM OLD.taken_at THEN RAISE EXCEPTION 'Original provenance is immutable'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.property_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.canvassiq_properties WHERE id=NEW.property_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Property belongs to another company'; END IF;
  IF split_part(NEW.storage_path,'/',1)<>NEW.tenant_id::text THEN RAISE EXCEPTION 'Invalid company path'; END IF;
  IF auth.uid() IS NOT NULL AND (NOT public.canvass_photo_tenant_allowed(NEW.tenant_id) OR NEW.uploaded_by IS DISTINCT FROM auth.uid()) THEN RAISE EXCEPTION 'Company or uploader mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvass_photo_reference_guard BEFORE INSERT OR UPDATE OR DELETE ON public.canvass_photos FOR EACH ROW EXECUTE FUNCTION public.canvass_photo_reference_guard();
REVOKE ALL ON FUNCTION public.canvass_photo_reference_guard() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.canvass_training_reference_locked(path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.photo_training_originals WHERE storage_bucket='canvass-photos' AND storage_path=path)
$$;
REVOKE ALL ON FUNCTION public.canvass_training_reference_locked(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.canvass_training_reference_locked(text) TO authenticated,service_role;
CREATE POLICY canvass_training_evidence_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING(bucket_id<>'canvass-photos' OR NOT public.canvass_training_reference_locked(name))
  WITH CHECK(bucket_id<>'canvass-photos' OR NOT public.canvass_training_reference_locked(name));
CREATE POLICY canvass_training_evidence_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING(bucket_id<>'canvass-photos' OR NOT public.canvass_training_reference_locked(name));

-- Applied live remediation: private implementation, public invoker wrapper.
ALTER FUNCTION public.canvass_training_reference_locked(text) SET SCHEMA photo_training_internal;
CREATE FUNCTION public.canvass_training_reference_locked(path text) RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT photo_training_internal.canvass_training_reference_locked(path) $$;
REVOKE ALL ON FUNCTION public.canvass_training_reference_locked(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.canvass_training_reference_locked(text) TO authenticated,service_role;
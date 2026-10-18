CREATE OR REPLACE FUNCTION public.photo_training_integrity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ DECLARE r jsonb; p jsonb; BEGIN
IF TG_TABLE_NAME='photo_training_originals' THEN IF NEW.sha256 !~ '^[a-f0-9]{64}$' OR length(btrim(NEW.property_id))=0 OR NEW.width<=0 OR NEW.height<=0 OR split_part(NEW.storage_path,'/',1)<>NEW.tenant_id::text THEN RAISE EXCEPTION 'Invalid original metadata'; END IF;
ELSIF TG_TABLE_NAME='photo_training_labels' THEN
IF NOT EXISTS(SELECT 1 FROM public.photo_training_originals WHERE id=NEW.original_id AND tenant_id=NEW.tenant_id) OR NEW.roof_system NOT IN ('shingle','clay_tile','concrete_tile','metal','flat','envelope') OR jsonb_typeof(NEW.regions) IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.annotations) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid company label'; END IF;
FOR r IN SELECT value FROM jsonb_array_elements(NEW.regions) LOOP
IF r->>'cls' IS NULL OR public.photo_training_class_valid(NEW.roof_system,r->>'cls') IS DISTINCT FROM true OR jsonb_typeof(r->'polygon') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'polygon')<3 THEN RAISE EXCEPTION 'Invalid region'; END IF;
FOR p IN SELECT value FROM jsonb_array_elements(r->'polygon') LOOP IF jsonb_typeof(p->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'y') IS DISTINCT FROM 'number' OR (p->>'x')::numeric NOT BETWEEN 0 AND 1 OR (p->>'y')::numeric NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'Incomplete region coordinates'; END IF;END LOOP;END LOOP;
IF NEW.status='approved' AND (NEW.approved_by IS NULL OR NEW.approved_by=NEW.labeled_by) THEN RAISE EXCEPTION 'Independent reviewer required'; END IF;
ELSIF TG_TABLE_NAME='photo_damage_models' THEN
IF NOT EXISTS(SELECT 1 FROM public.photo_training_datasets WHERE id=NEW.dataset_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Dataset belongs to another company'; END IF;
IF TG_OP='UPDATE' AND OLD.status='active' AND NEW.status NOT IN ('active','approved') THEN RAISE EXCEPTION 'Active checkpoint cannot be modified or re-evaluated'; END IF;
IF NEW.metrics IS NOT NULL AND (jsonb_typeof(NEW.metrics->'classes') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.metrics->'predictions') IS DISTINCT FROM 'array' OR NEW.metrics->>'checkpoint_sha256' IS DISTINCT FROM NEW.checkpoint_sha256) THEN RAISE EXCEPTION 'Incomplete checkpoint evaluation'; END IF;
ELSIF TG_TABLE_NAME='photo_damage_deployments' THEN
IF NOT EXISTS(SELECT 1 FROM public.photo_damage_models WHERE id=NEW.model_id AND tenant_id=NEW.tenant_id) OR (NEW.previous_model_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.photo_damage_models WHERE id=NEW.previous_model_id AND tenant_id=NEW.tenant_id)) THEN RAISE EXCEPTION 'Cross-company deployment denied'; END IF;
END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.photo_training_integrity_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER training_original_integrity BEFORE INSERT ON public.photo_training_originals FOR EACH ROW EXECUTE FUNCTION public.photo_training_integrity_guard();
CREATE TRIGGER training_label_integrity BEFORE INSERT OR UPDATE ON public.photo_training_labels FOR EACH ROW EXECUTE FUNCTION public.photo_training_integrity_guard();
CREATE TRIGGER training_model_integrity BEFORE INSERT OR UPDATE ON public.photo_damage_models FOR EACH ROW EXECUTE FUNCTION public.photo_training_integrity_guard();
CREATE TRIGGER training_deployment_integrity BEFORE INSERT ON public.photo_damage_deployments FOR EACH ROW EXECUTE FUNCTION public.photo_training_integrity_guard();
CREATE UNIQUE INDEX photo_damage_one_active ON public.photo_damage_models(tenant_id) WHERE status='active';
CREATE INDEX photo_training_labels_scope ON public.photo_training_labels(tenant_id,status);
CREATE INDEX photo_training_events_scope ON public.photo_training_events(tenant_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.photo_training_immutable_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN RAISE EXCEPTION 'Originals, dataset snapshots and audit history are immutable'; END $$;
REVOKE ALL ON FUNCTION public.photo_training_immutable_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER training_original_immutable BEFORE UPDATE OR DELETE ON public.photo_training_originals FOR EACH ROW EXECUTE FUNCTION public.photo_training_immutable_guard();
CREATE TRIGGER training_dataset_immutable BEFORE UPDATE OR DELETE ON public.photo_training_datasets FOR EACH ROW EXECUTE FUNCTION public.photo_training_immutable_guard();
CREATE TRIGGER training_events_immutable BEFORE UPDATE OR DELETE ON public.photo_training_events FOR EACH ROW EXECUTE FUNCTION public.photo_training_immutable_guard();
CREATE TRIGGER training_deployments_immutable BEFORE UPDATE OR DELETE ON public.photo_damage_deployments FOR EACH ROW EXECUTE FUNCTION public.photo_training_immutable_guard();
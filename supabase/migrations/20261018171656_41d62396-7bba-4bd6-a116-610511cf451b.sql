CREATE OR REPLACE FUNCTION photo_training_internal.photo_damage_model_evaluate(m uuid,hash text,predictions jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE model public.photo_damage_models; ds jsonb; photo jsonb; pred jsonb; region jsonb; gt jsonb; truths jsonb:='[]'; matched jsonb:='{}'; counts jsonb:='{}'; key text; bestkey text; best numeric; overlap numeric; box jsonb; gx0 numeric;gy0 numeric;gx1 numeric;gy1 numeric;px0 numeric;py0 numeric;px1 numeric;py1 numeric; inter numeric; uni numeric; ix integer:=0; slot jsonb; output jsonb:='[]'; v record; evaluated integer:=0; BEGIN
SELECT * INTO model FROM public.photo_damage_models WHERE id=m FOR UPDATE; IF model.id IS NULL OR NOT public.photo_training_access(model.tenant_id) THEN RAISE EXCEPTION 'Company access denied'; END IF;
IF model.status='active' OR hash<>model.checkpoint_sha256 OR jsonb_typeof(predictions)<>'array' THEN RAISE EXCEPTION 'Invalid evaluation or active model is immutable'; END IF;
SELECT manifest INTO ds FROM public.photo_training_datasets WHERE id=model.dataset_id AND tenant_id=model.tenant_id;
FOR photo IN SELECT value FROM jsonb_array_elements(ds->'photos') LOOP IF ds->'split'->>(photo->>'photoId')<>'test' THEN CONTINUE; END IF; evaluated:=evaluated+1;
FOR region IN SELECT value FROM jsonb_array_elements(photo->'regions') LOOP
SELECT min((p->>'x')::numeric),min((p->>'y')::numeric),max((p->>'x')::numeric),max((p->>'y')::numeric) INTO gx0,gy0,gx1,gy1 FROM jsonb_array_elements(region->'polygon') p;
truths:=truths||jsonb_build_array(jsonb_build_object('id',ix::text,'photoId',photo->>'photoId','cls',region->>'cls','system',photo->>'roofSystem','box',jsonb_build_object('x0',gx0,'y0',gy0,'x1',gx1,'y1',gy1))); ix:=ix+1;
key:=(photo->>'roofSystem')||':'||(region->>'cls'); slot:=coalesce(counts->key,jsonb_build_object('tp',0,'fp',0,'fn',0)); counts:=jsonb_set(counts,ARRAY[key],slot||jsonb_build_object('fn',(slot->>'fn')::integer+1));
END LOOP; END LOOP;
IF evaluated=0 THEN RAISE EXCEPTION 'Dataset has no held-out properties'; END IF;
FOR pred IN SELECT value FROM jsonb_array_elements(predictions) ORDER BY (value->>'confidence')::numeric DESC LOOP
SELECT value INTO photo FROM jsonb_array_elements(ds->'photos') WHERE value->>'photoId'=pred->>'photoId';
IF photo IS NULL OR ds->'split'->>(pred->>'photoId')<>'test' OR NOT public.photo_training_class_valid(photo->>'roofSystem',pred->>'cls') OR jsonb_typeof(pred->'confidence')<>'number' OR (pred->>'confidence')::numeric NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'Prediction is not valid held-out evidence'; END IF;
box:=pred->'box'; IF jsonb_typeof(box->'x0')<>'number' OR jsonb_typeof(box->'y0')<>'number' OR jsonb_typeof(box->'x1')<>'number' OR jsonb_typeof(box->'y1')<>'number' THEN RAISE EXCEPTION 'Invalid box'; END IF;
px0:=(box->>'x0')::numeric;py0:=(box->>'y0')::numeric;px1:=(box->>'x1')::numeric;py1:=(box->>'y1')::numeric;
IF px0<0 OR py0<0 OR px1>1 OR py1>1 OR px1<=px0 OR py1<=py0 THEN RAISE EXCEPTION 'Invalid box'; END IF;
best:=0;bestkey:=NULL;
FOR gt IN SELECT value FROM jsonb_array_elements(truths) LOOP IF gt->>'photoId'<>pred->>'photoId' OR gt->>'cls'<>pred->>'cls' OR matched ? (gt->>'id') THEN CONTINUE; END IF;
gx0:=(gt->'box'->>'x0')::numeric;gy0:=(gt->'box'->>'y0')::numeric;gx1:=(gt->'box'->>'x1')::numeric;gy1:=(gt->'box'->>'y1')::numeric;
inter:=greatest(0,least(px1,gx1)-greatest(px0,gx0))*greatest(0,least(py1,gy1)-greatest(py0,gy0));uni:=(px1-px0)*(py1-py0)+(gx1-gx0)*(gy1-gy0)-inter;overlap:=CASE WHEN uni>0 THEN inter/uni ELSE 0 END;
IF overlap>best THEN best:=overlap;bestkey:=gt->>'id'; END IF; END LOOP;
key:=(photo->>'roofSystem')||':'||(pred->>'cls');slot:=coalesce(counts->key,jsonb_build_object('tp',0,'fp',0,'fn',0));
IF best>=0.5 THEN matched:=matched||jsonb_build_object(bestkey,true);slot:=slot||jsonb_build_object('tp',(slot->>'tp')::integer+1,'fn',(slot->>'fn')::integer-1); ELSE slot:=slot||jsonb_build_object('fp',(slot->>'fp')::integer+1); END IF;counts:=jsonb_set(counts,ARRAY[key],slot);
END LOOP;
FOR v IN SELECT * FROM jsonb_each(counts) LOOP slot:=v.value;output:=output||jsonb_build_array(slot||jsonb_build_object('key',v.key,'precision',CASE WHEN (slot->>'tp')::numeric+(slot->>'fp')::numeric>0 THEN (slot->>'tp')::numeric/((slot->>'tp')::numeric+(slot->>'fp')::numeric) ELSE 0 END,'recall',CASE WHEN (slot->>'tp')::numeric+(slot->>'fn')::numeric>0 THEN (slot->>'tp')::numeric/((slot->>'tp')::numeric+(slot->>'fn')::numeric) ELSE 0 END)); END LOOP;
UPDATE public.photo_damage_models SET metrics=jsonb_build_object('partition','test','photosEvaluated',evaluated,'classes',output,'checkpoint_sha256',hash,'predictions',predictions),status='evaluated',approved_by=NULL,license_approved_by=NULL,updated_at=now() WHERE id=m;
INSERT INTO public.photo_training_events(tenant_id,model_id,action,snapshot) VALUES(model.tenant_id,m,'evaluate',jsonb_build_object('partition','test','classes',output,'checkpoint_sha256',hash)); END $$;
REVOKE ALL ON FUNCTION photo_training_internal.photo_damage_model_evaluate(uuid,text,jsonb) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION photo_training_internal.photo_damage_model_evaluate(uuid,text,jsonb) TO authenticated,service_role;
CREATE FUNCTION public.photo_damage_model_evaluate(m uuid,hash text,predictions jsonb) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT photo_training_internal.photo_damage_model_evaluate(m,hash,predictions) $$;
REVOKE ALL ON FUNCTION public.photo_damage_model_evaluate(uuid,text,jsonb) FROM PUBLIC,anon;GRANT EXECUTE ON FUNCTION public.photo_damage_model_evaluate(uuid,text,jsonb) TO authenticated,service_role;
CREATE FUNCTION public.photo_training_model_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ DECLARE ds jsonb; p jsonb; r jsonb; k text; BEGIN
IF NEW.configuration->>'framework' IS DISTINCT FROM 'torchvision-fasterrcnn' OR NEW.configuration->>'pretrained_weights' IS DISTINCT FROM 'none' THEN RAISE EXCEPTION 'Framework and weights must be explicit'; END IF;
IF NEW.status='active' THEN
SELECT manifest INTO ds FROM public.photo_training_datasets WHERE id=NEW.dataset_id AND tenant_id=NEW.tenant_id;
FOR p IN SELECT value FROM jsonb_array_elements(ds->'photos') LOOP FOR r IN SELECT value FROM jsonb_array_elements(p->'regions') LOOP k:=(p->>'roofSystem')||':'||(r->>'cls');
IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.metrics->'classes') x WHERE x->>'key'=k AND (x->>'tp')::integer+(x->>'fn')::integer>=30 AND (x->>'precision')::numeric>=0.9 AND (x->>'recall')::numeric>=0.9) THEN RAISE EXCEPTION 'Every dataset damage class must pass unseen-property gates'; END IF; END LOOP;END LOOP; END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.photo_training_model_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER training_model_guard BEFORE INSERT OR UPDATE ON public.photo_damage_models FOR EACH ROW EXECUTE FUNCTION public.photo_training_model_guard();
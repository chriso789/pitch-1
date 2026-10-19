-- Run against isolated fixture database only, never production.
BEGIN;
INSERT INTO user_company_access(user_id,tenant_id,is_active) VALUES
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true),
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',true),
 ('00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002',true);
INSERT INTO canvassiq_properties(id,tenant_id) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('canvass-photos','10000000-0000-0000-0000-000000000001/roof.jpg','{"mimetype":"image/jpeg"}');
INSERT INTO canvass_photos(id,tenant_id,property_id,storage_path,category,uploaded_by,latitude,longitude,taken_at)
VALUES('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001/roof.jpg','roof_damage','00000000-0000-0000-0000-000000000001',30,-85,'2026-10-19T02:48:00Z');
DO $$ BEGIN
  BEGIN
    PERFORM photo_training_canvass_register('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',repeat('a',64),1000,800);
    RAISE EXCEPTION 'TEST FAILED: cross-company registration accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF; END;
END $$;
SELECT photo_training_canvass_register('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',repeat('a',64),1000,800);
SELECT photo_training_canvass_register('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',repeat('a',64),1000,800);
DO $$ DECLARE o photo_training_originals; BEGIN
 SELECT * INTO o FROM photo_training_originals WHERE source_photo_id='30000000-0000-0000-0000-000000000001';
 IF (SELECT count(*) FROM photo_training_originals)<>1 OR o.storage_bucket<>'canvass-photos' OR o.source_metadata->>'repObservation'<>'roof_damage' OR o.source_metadata->>'latitude'<>'30' OR o.property_id<>'20000000-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'TEST FAILED: provenance/retry'; END IF;
 IF EXISTS(SELECT 1 FROM photo_training_labels) THEN RAISE EXCEPTION 'TEST FAILED: rep category became label'; END IF;
 IF NOT canvass_training_reference_locked(o.storage_path) THEN RAISE EXCEPTION 'TEST FAILED: original not locked'; END IF;
 BEGIN
   UPDATE canvass_photos SET property_id='20000000-0000-0000-0000-000000000002';
   RAISE EXCEPTION 'TEST FAILED: cross-property update accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('test.user','00000000-0000-0000-0000-000000000001',true);
SELECT photo_training_label_save(id,'clay_tile','[{"cls":"normal_tile_alignment","polygon":[{"x":0.1,"y":0.1},{"x":0.4,"y":0.1},{"x":0.4,"y":0.4}]}]','{}',false,'{}',true,0) FROM photo_training_originals;
DO $$ DECLARE l photo_training_labels; BEGIN
 SELECT * INTO l FROM photo_training_labels LIMIT 1;
 BEGIN
   PERFORM photo_training_label_review(l.id,'approve','',l.revision);
   RAISE EXCEPTION 'TEST FAILED: self approval accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF; END;
 BEGIN
   PERFORM photo_training_dataset_create(l.tenant_id,'before-approval');
   RAISE EXCEPTION 'TEST FAILED: pending training accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'TEST FAILED%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('test.user','00000000-0000-0000-0000-000000000002',true);
SELECT photo_training_label_review(id,'approve','independent visual review',revision) FROM photo_training_labels;
SELECT photo_training_dataset_create('10000000-0000-0000-0000-000000000001','approved');
DO $$ DECLARE d jsonb; BEGIN
 SELECT manifest INTO d FROM photo_training_datasets WHERE version='approved';
 IF d->'photos'->0->>'storageBucket'<>'canvass-photos' OR d->'photos'->0->>'approvedBy'<>'00000000-0000-0000-0000-000000000002' OR d->'classes'->>0<>'normal_tile_alignment' THEN RAISE EXCEPTION 'TEST FAILED: approved export eligibility'; END IF;
END $$;
SELECT set_config('test.user','00000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM photo_training_originals) OR EXISTS(SELECT 1 FROM photo_training_labels) OR EXISTS(SELECT 1 FROM photo_training_datasets) THEN RAISE EXCEPTION 'TEST FAILED: company data visible'; END IF;
 IF has_function_privilege('authenticated','public.photo_training_canvass_register(uuid,uuid,text,integer,integer)','EXECUTE') THEN RAISE EXCEPTION 'TEST FAILED: untrusted hash intake exposed'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: zero-copy provenance, deduplication, property ownership, preliminary labels, independent approval, training eligibility, company isolation and trusted intake';
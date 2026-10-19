-- Security test for public.review_reference_candidate. Runs inside a transaction and rolls back.
-- Run as a database owner: psql -v ON_ERROR_STOP=1 -f tests/database/review-reference-candidate.sql
BEGIN;
DO $$
DECLARE t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); x uuid := gen_random_uuid();
  c1 uuid; c2 uuid; ok boolean;
BEGIN
  -- user_company_access rows (fixture); a,b in t1; x in t2 only
  INSERT INTO public.user_company_access(user_id, tenant_id) VALUES (a, t1), (b, t1), (x, t2);
  INSERT INTO public.photo_reference_candidates(tenant_id, source_photo_id, source_property_key, cls, polygon, embedding, embedding_model_id, labeled_by)
    VALUES (t1, gen_random_uuid(), 'lead:1', 'clay_tile', '[]', '[1]', 'dinov2-small', a) RETURNING id INTO c1;
  INSERT INTO public.photo_reference_candidates(tenant_id, source_photo_id, source_property_key, cls, polygon, embedding, embedding_model_id, labeled_by)
    VALUES (t1, gen_random_uuid(), 'lead:2', 'clay_tile', '[]', '[1]', 'dinov2-small', a) RETURNING id INTO c2;
  SET LOCAL ROLE authenticated;

  -- 1 unauthenticated
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN PERFORM public.review_reference_candidate(c1, 'approved'); RAISE EXCEPTION 'FAIL: anonymous review allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  -- 2 self-approval
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.review_reference_candidate(c1, 'approved'); RAISE EXCEPTION 'FAIL: self review allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  -- 3 cross-company
  PERFORM set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.review_reference_candidate(c1, 'approved'); RAISE EXCEPTION 'FAIL: cross-company review allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  -- 4 direct table approval bypass blocked; 5 independent reviewer succeeds once
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  BEGIN UPDATE public.photo_reference_candidates SET review_status = 'approved' WHERE id = c2; RAISE EXCEPTION 'FAIL: direct update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.review_reference_candidate(c1, 'rejected', 'not a tile');
  -- 6 repeat review blocked
  BEGIN PERFORM public.review_reference_candidate(c1, 'approved'); RAISE EXCEPTION 'FAIL: repeat review allowed'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  -- 7 rejection needs a reason
  BEGIN PERFORM public.review_reference_candidate(c2, 'rejected'); RAISE EXCEPTION 'FAIL: reasonless rejection'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  RESET ROLE;
  SELECT approved_by IS NULL AND review_status = 'rejected' INTO ok FROM public.photo_reference_candidates WHERE id = c1;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL: rejected label has approval'; END IF;
  RAISE NOTICE 'review_reference_candidate: all checks passed';
END $$;
ROLLBACK;

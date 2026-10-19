-- Security test for public.review_reference_candidate. Runs inside a transaction and rolls back.
-- Run as a database owner: psql -v ON_ERROR_STOP=1 -f tests/database/review-reference-candidate.sql
BEGIN;
DO $$
DECLARE t1 uuid; a uuid; b uuid; x uuid; c1 uuid; c2 uuid; ok boolean;
BEGIN
  -- Uses two existing members of one company (a labels, b reviews) and one outsider x; rolled back.
  SELECT u1.tenant_id, u1.user_id, u2.user_id INTO t1, a, b FROM public.user_company_access u1 JOIN public.user_company_access u2 ON u2.tenant_id = u1.tenant_id AND u2.user_id <> u1.user_id LIMIT 1;
  SELECT user_id INTO x FROM public.user_company_access WHERE user_id NOT IN (SELECT user_id FROM public.user_company_access WHERE tenant_id = t1) LIMIT 1;
  IF t1 IS NULL OR x IS NULL THEN RAISE EXCEPTION 'FIXTURE_MISSING'; END IF;
  INSERT INTO public.photo_reference_candidates(tenant_id, source_photo_id, source_property_key, cls, polygon, image_hash, embedding, embedding_model_id, labeled_by)
    VALUES (t1, gen_random_uuid(), 'lead:test1', 'clay_tile', '[]', 'test', '[1]', 'dinov2-small', a) RETURNING id INTO c1;
  INSERT INTO public.photo_reference_candidates(tenant_id, source_photo_id, source_property_key, cls, polygon, image_hash, embedding, embedding_model_id, labeled_by)
    VALUES (t1, gen_random_uuid(), 'lead:test2', 'clay_tile', '[]', 'test', '[1]', 'dinov2-small', a) RETURNING id INTO c2;
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

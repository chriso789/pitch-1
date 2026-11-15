-- Exclusive claims: only service workers can dequeue; never blindly replay an
-- interrupted run whose external delivery outcome may be unknown.
CREATE OR REPLACE FUNCTION public.claim_automation_runs(p_limit integer DEFAULT 25)
RETURNS SETOF public.automation_runs
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.automation_runs r SET status = 'running', started_at = now()
  WHERE r.id IN (
    SELECT id FROM public.automation_runs WHERE status = 'queued'
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ) RETURNING r.*;
$$;
REVOKE ALL ON FUNCTION public.claim_automation_runs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_automation_runs(integer) TO service_role;

-- A claim acknowledges an already fulfilled/sent reward, never authorizes a payout.
CREATE OR REPLACE FUNCTION public.claim_canvass_reward(p_reward_id uuid, p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.achievement_rewards;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.get_user_tenant_ids() AS ids(tenant_id) WHERE ids.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.achievement_rewards WHERE id = p_reward_id AND tenant_id = p_tenant_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reward not found'; END IF;
  IF r.status = 'claimed' THEN RETURN jsonb_build_object('success', true, 'already_claimed', true); END IF;
  IF r.status NOT IN ('sent', 'delivered') THEN RAISE EXCEPTION 'Reward is not ready to claim'; END IF;
  UPDATE public.achievement_rewards SET status = 'claimed', claimed_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_canvass_reward(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_canvass_reward(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_crew_job_requirements(p_job_id uuid, p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, crew AS $$
DECLARE buckets jsonb; items jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM crew.job_assignments WHERE job_id = p_job_id AND company_id = p_company_id AND subcontractor_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Assignment not found' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]') INTO buckets FROM (
    SELECT pb.id, pb.key, pb.label, pb.description, r.required_count AS "requiredCount", r.is_required AS "isRequired",
      (SELECT count(*) FROM crew.job_photos p WHERE p.company_id = p_company_id AND p.job_id = p_job_id AND p.subcontractor_user_id = auth.uid() AND p.bucket_id = pb.id) AS "currentCount"
    FROM crew.job_photo_requirements r JOIN crew.photo_buckets pb ON pb.id = r.bucket_id AND pb.company_id = p_company_id
    WHERE r.company_id = p_company_id AND r.job_id = p_job_id
  ) b;
  SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i."sortOrder"), '[]') INTO items FROM (
    SELECT ci.id, jc.id AS "checklistId", ci.sort_order AS "sortOrder", ci.label, ci.help_text AS "helpText",
      ci.requires_photo AS "requiresPhoto", ci.is_required AS "isRequired", COALESCE(r.is_checked, false) AS "isChecked",
      r.proof_photo_id AS "proofPhotoId", r.note, r.id AS "responseId"
    FROM crew.job_checklists jc JOIN crew.checklist_items ci ON ci.template_id = jc.template_id
    LEFT JOIN crew.job_checklist_responses r ON r.job_checklist_id = jc.id AND r.item_id = ci.id AND r.company_id = p_company_id AND r.subcontractor_user_id = auth.uid()
    WHERE jc.company_id = p_company_id AND jc.job_id = p_job_id
  ) i;
  RETURN jsonb_build_object('photoBuckets', buckets, 'checklistItems', items);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_crew_checklist_response(p_job_id uuid, p_company_id uuid, p_checklist_id uuid, p_item_id uuid, p_checked boolean, p_proof_photo_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, crew AS $$
DECLARE needs_photo boolean;
BEGIN
  PERFORM 1 FROM crew.job_assignments WHERE job_id = p_job_id AND company_id = p_company_id AND subcontractor_user_id = auth.uid() AND NOT is_locked FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Assignment not found or locked' USING ERRCODE = '42501'; END IF;
  SELECT ci.requires_photo INTO needs_photo FROM crew.job_checklists jc JOIN crew.checklist_items ci ON ci.template_id = jc.template_id
    WHERE jc.id = p_checklist_id AND jc.company_id = p_company_id AND jc.job_id = p_job_id AND ci.id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checklist item not found'; END IF;
  IF p_proof_photo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crew.job_photos WHERE id = p_proof_photo_id AND company_id = p_company_id AND job_id = p_job_id AND subcontractor_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Proof photo does not belong to this assignment';
  END IF;
  IF p_checked AND needs_photo AND p_proof_photo_id IS NULL THEN RAISE EXCEPTION 'Photo proof required'; END IF;
  INSERT INTO crew.job_checklist_responses(company_id, job_checklist_id, item_id, subcontractor_user_id, is_checked, proof_photo_id, checked_at)
    VALUES(p_company_id, p_checklist_id, p_item_id, auth.uid(), p_checked, p_proof_photo_id, CASE WHEN p_checked THEN now() END)
  ON CONFLICT(company_id, job_checklist_id, item_id, subcontractor_user_id) DO UPDATE SET
    is_checked = EXCLUDED.is_checked, proof_photo_id = EXCLUDED.proof_photo_id, checked_at = EXCLUDED.checked_at;
END;
$$;
REVOKE ALL ON FUNCTION public.get_crew_job_requirements(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_crew_checklist_response(uuid, uuid, uuid, uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crew_job_requirements(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_crew_checklist_response(uuid, uuid, uuid, uuid, boolean, uuid) TO authenticated;

-- Remove the old first-checklist-only completion behavior.
CREATE OR REPLACE FUNCTION crew.checklist_met(_company_id uuid, _job_id uuid, _sub_user uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS (
   SELECT 1 FROM crew.job_checklists jc JOIN crew.checklist_items ci ON ci.template_id = jc.template_id
   LEFT JOIN crew.job_checklist_responses r ON r.job_checklist_id = jc.id AND r.item_id = ci.id AND r.company_id = _company_id AND r.subcontractor_user_id = _sub_user
   WHERE jc.company_id = _company_id AND jc.job_id = _job_id AND ci.is_required
   AND (r.id IS NULL OR NOT r.is_checked OR (ci.requires_photo AND NOT EXISTS (
     SELECT 1 FROM crew.job_photos p WHERE p.id = r.proof_photo_id AND p.company_id = _company_id AND p.job_id = _job_id AND p.subcontractor_user_id = _sub_user
   )))
 );
$$;

-- Preserve any older photo records that used the assignment id as their job id.
UPDATE crew.job_photos p SET job_id = a.job_id FROM crew.job_assignments a
WHERE p.job_id = a.id AND p.company_id = a.company_id AND p.subcontractor_user_id = a.subcontractor_user_id;

-- Canonical photo records use the real job id and subcontractor_user_id, as
-- required by the completion gates (the previous public RPC used an assignment id).
CREATE OR REPLACE FUNCTION public.insert_crew_job_photo(p_id uuid, p_company_id uuid, p_job_id uuid, p_bucket_id uuid, p_file_url text, p_gps_lat numeric DEFAULT NULL, p_gps_lng numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, crew AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM crew.job_assignments WHERE job_id = p_job_id AND company_id = p_company_id AND subcontractor_user_id = auth.uid() AND NOT is_locked) THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF NOT EXISTS (SELECT 1 FROM crew.photo_buckets WHERE id = p_bucket_id AND company_id = p_company_id) THEN RAISE EXCEPTION 'Invalid photo bucket'; END IF;
 INSERT INTO crew.job_photos(id, company_id, job_id, bucket_id, subcontractor_user_id, file_url, gps_lat, gps_lng)
 VALUES(p_id, p_company_id, p_job_id, p_bucket_id, auth.uid(), p_file_url, p_gps_lat, p_gps_lng);
 RETURN p_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.get_crew_job_photos(p_job_id uuid, p_company_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, bucket_id uuid, file_url text, taken_at timestamptz, gps_lat numeric, gps_lng numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, crew AS $$
 SELECT p.id, p.bucket_id, p.file_url, p.taken_at, p.gps_lat, p.gps_lng FROM crew.job_photos p
 WHERE p.job_id = p_job_id AND p.subcontractor_user_id = auth.uid() AND (p_company_id IS NULL OR p.company_id = p_company_id)
 AND EXISTS (SELECT 1 FROM crew.job_assignments ja WHERE ja.job_id = p_job_id AND ja.company_id = p.company_id AND ja.subcontractor_user_id = auth.uid())
 ORDER BY p.taken_at DESC;
$$;
REVOKE ALL ON FUNCTION public.insert_crew_job_photo(uuid, uuid, uuid, uuid, text, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_crew_job_photos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_crew_job_photo(uuid, uuid, uuid, uuid, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_crew_job_photos(uuid, uuid) TO authenticated;

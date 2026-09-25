CREATE TABLE public.commercial_estimate_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  version_id uuid NOT NULL REFERENCES public.commercial_estimate_versions(id) ON DELETE CASCADE,
  step text NOT NULL,
  decision text NOT NULL,
  decided_by uuid,
  comments text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.commercial_estimate_approvals TO authenticated;
GRANT ALL ON public.commercial_estimate_approvals TO service_role;
ALTER TABLE public.commercial_estimate_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant read approvals" ON public.commercial_estimate_approvals FOR SELECT TO authenticated
USING (tenant_id = public.get_user_tenant_id() OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = auth.uid() AND (r.tenant_id = commercial_estimate_approvals.tenant_id OR r.role = 'master')));

CREATE OR REPLACE FUNCTION public.commercial_required_steps(_amount numeric)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _amount > 500000 THEN ARRAY['estimator','senior_estimator','executive']
              WHEN _amount >= 100000 THEN ARRAY['estimator','senior_estimator']
              ELSE ARRAY['estimator'] END $$;

CREATE OR REPLACE FUNCTION public.commercial_decide_version(_version_id uuid, _decision text, _comments text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record; steps text[]; done text[]; nxt text; roles text[]; ok boolean;
BEGIN
  IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO v FROM commercial_estimate_versions WHERE id = _version_id;
  IF v IS NULL THEN RAISE EXCEPTION 'Version not found'; END IF;
  IF v.status IN ('approved','rejected') THEN RAISE EXCEPTION 'This version is already %', v.status; END IF;
  SELECT array_agg(role::text) INTO roles FROM user_roles WHERE user_id = auth.uid() AND (tenant_id = v.tenant_id OR role = 'master');
  IF roles IS NULL AND public.get_user_tenant_id() IS DISTINCT FROM v.tenant_id THEN RAISE EXCEPTION 'Not allowed'; END IF;
  roles := coalesce(roles, ARRAY[]::text[]);
  steps := commercial_required_steps(coalesce(v.bid_total,0));
  SELECT coalesce(array_agg(step), ARRAY[]::text[]) INTO done FROM commercial_estimate_approvals WHERE version_id = _version_id AND decision = 'approved';
  SELECT s INTO nxt FROM unnest(steps) WITH ORDINALITY t(s, i) WHERE NOT (s = ANY(done)) ORDER BY i LIMIT 1;
  IF nxt IS NULL THEN RAISE EXCEPTION 'Nothing left to approve'; END IF;
  ok := CASE nxt
    WHEN 'estimator' THEN true
    WHEN 'senior_estimator' THEN roles && ARRAY['master','owner','corporate','office_admin','regional_manager','sales_manager']
    WHEN 'executive' THEN roles && ARRAY['master','owner','corporate'] END;
  IF NOT ok THEN RAISE EXCEPTION 'The % step needs a higher role', replace(nxt,'_',' '); END IF;
  INSERT INTO commercial_estimate_approvals(tenant_id, version_id, step, decision, decided_by, comments)
  VALUES (v.tenant_id, _version_id, nxt, _decision, auth.uid(), _comments);
  IF _decision = 'rejected' THEN
    UPDATE commercial_estimate_versions SET status='rejected', comments=_comments WHERE id=_version_id;
    UPDATE commercial_estimates SET status='draft' WHERE id=v.estimate_id;
  ELSIF nxt = steps[array_length(steps,1)] THEN
    UPDATE commercial_estimate_versions SET status='approved', approved_by=auth.uid(), approved_at=now() WHERE id=_version_id;
    UPDATE commercial_estimates SET status='approved' WHERE id=v.estimate_id;
  ELSE
    UPDATE commercial_estimate_versions SET status='pending_'||steps[array_position(steps,nxt)+1] WHERE id=_version_id;
  END IF;
  RETURN jsonb_build_object('step', nxt, 'decision', _decision);
END $$;
GRANT EXECUTE ON FUNCTION public.commercial_decide_version(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_required_steps(numeric) TO authenticated;
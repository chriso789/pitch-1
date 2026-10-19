ALTER TABLE public.photo_reference_candidates
  ADD COLUMN review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN reviewed_by uuid,
  ADD COLUMN reviewed_at timestamptz,
  ADD CONSTRAINT prc_review_status CHECK (review_status IN ('pending','approved','rejected','needs_correction')),
  ADD CONSTRAINT prc_reviewer_independent CHECK (reviewed_by IS NULL OR reviewed_by <> labeled_by);
UPDATE public.photo_reference_candidates SET review_status = 'approved', reviewed_by = approved_by, reviewed_at = approved_at WHERE approved_by IS NOT NULL;

CREATE TABLE public.photo_reference_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.photo_reference_candidates(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('approved','rejected','needs_correction')),
  reason text,
  previous_cls text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.photo_reference_reviews TO authenticated;
GRANT ALL ON public.photo_reference_reviews TO service_role;
ALTER TABLE public.photo_reference_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY prr_select ON public.photo_reference_reviews FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_reference_reviews.tenant_id));

CREATE OR REPLACE FUNCTION public.review_reference_candidate(_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.photo_reference_candidates%ROWTYPE;
BEGIN
  IF _action NOT IN ('approved','rejected','needs_correction') THEN RAISE EXCEPTION 'Invalid review action'; END IF;
  SELECT * INTO c FROM public.photo_reference_candidates WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Label not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = c.tenant_id) THEN RAISE EXCEPTION 'Not authorized for this company'; END IF;
  IF c.labeled_by = auth.uid() THEN RAISE EXCEPTION 'You cannot review your own label'; END IF;
  IF c.review_status <> 'pending' THEN RAISE EXCEPTION 'This label was already reviewed'; END IF;
  IF _action <> 'approved' AND coalesce(trim(_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE public.photo_reference_candidates SET review_status = _action, reviewed_by = auth.uid(), reviewed_at = now(),
    review_comment = nullif(trim(_reason), ''),
    approved_by = CASE WHEN _action = 'approved' THEN auth.uid() ELSE NULL END,
    approved_at = CASE WHEN _action = 'approved' THEN now() ELSE NULL END
  WHERE id = _id;
  INSERT INTO public.photo_reference_reviews(candidate_id, tenant_id, reviewer_id, action, reason, previous_cls)
  VALUES (_id, c.tenant_id, auth.uid(), _action, nullif(trim(_reason), ''), c.cls);
END $$;
REVOKE ALL ON FUNCTION public.review_reference_candidate(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.review_reference_candidate(uuid, text, text) TO authenticated;

CREATE TABLE public.photo_triage_results (
  photo_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  property_key text NOT NULL,
  dhash text,
  sharpness real,
  brightness real,
  assessable boolean NOT NULL DEFAULT false,
  issues text[] NOT NULL DEFAULT '{}',
  processing_ms integer,
  processed_by uuid NOT NULL DEFAULT auth.uid(),
  processed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.photo_triage_results TO authenticated;
GRANT ALL ON public.photo_triage_results TO service_role;
ALTER TABLE public.photo_triage_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY ptr_rw ON public.photo_triage_results FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_triage_results.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_triage_results.tenant_id));
CREATE INDEX ptr_tenant_idx ON public.photo_triage_results(tenant_id);

CREATE TABLE public.photo_region_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_photo_id uuid NOT NULL,
  property_key text NOT NULL,
  polygon jsonb NOT NULL,
  group_index integer NOT NULL DEFAULT -1,
  suggestion jsonb,
  segmenter_model text,
  embedder_model text,
  timings_ms jsonb,
  status text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','labeled','dismissed')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_region_proposals TO authenticated;
GRANT ALL ON public.photo_region_proposals TO service_role;
ALTER TABLE public.photo_region_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY prp_rw ON public.photo_region_proposals FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_region_proposals.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_region_proposals.tenant_id));
CREATE INDEX prp_photo_idx ON public.photo_region_proposals(tenant_id, source_photo_id);
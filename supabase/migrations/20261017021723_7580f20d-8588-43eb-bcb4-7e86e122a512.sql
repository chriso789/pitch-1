CREATE TABLE public.photo_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID,
  job_id UUID,
  finding_ref TEXT NOT NULL,
  building_label TEXT,
  roof_plane TEXT,
  elevation TEXT,
  component TEXT NOT NULL DEFAULT 'unknown',
  material TEXT,
  visible_condition TEXT NOT NULL DEFAULT 'unspecified',
  condition_description TEXT,
  detection_source TEXT NOT NULL DEFAULT 'manual' CHECK (detection_source IN ('ai','reference_label','manual')),
  ai_confidence NUMERIC(5,4) CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  ai_model_version TEXT,
  evidence_quality TEXT,
  limitations TEXT,
  severity TEXT NOT NULL DEFAULT 'unknown' CHECK (severity IN ('immediate','high','moderate','low','cosmetic','unknown')),
  urgency TEXT NOT NULL DEFAULT 'unknown' CHECK (urgency IN ('emergency','priority','standard','monitor','unknown')),
  water_exposure_concern BOOLEAN NOT NULL DEFAULT false,
  recommended_verification TEXT,
  measured_quantity NUMERIC,
  measured_unit TEXT,
  measurement_source TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected','needs_closeup')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  estimate_link_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_findings TO authenticated;
GRANT ALL ON public.photo_findings TO service_role;
ALTER TABLE public.photo_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY photo_findings_tenant_all ON public.photo_findings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_findings.tenant_id AND uca.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_findings.tenant_id AND uca.is_active = true));

CREATE TABLE public.photo_finding_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  finding_id UUID NOT NULL REFERENCES public.photo_findings(id) ON DELETE CASCADE,
  photo_id UUID,
  storage_path TEXT,
  evidence_role TEXT NOT NULL DEFAULT 'supporting' CHECK (evidence_role IN ('primary','supporting','close_up')),
  annotation JSONB,
  annotation_source TEXT NOT NULL DEFAULT 'manual' CHECK (annotation_source IN ('ai','reference_label','manual')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_finding_evidence TO authenticated;
GRANT ALL ON public.photo_finding_evidence TO service_role;
ALTER TABLE public.photo_finding_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY photo_finding_evidence_tenant_all ON public.photo_finding_evidence FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_finding_evidence.tenant_id AND uca.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_finding_evidence.tenant_id AND uca.is_active = true));

CREATE TABLE public.photo_finding_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  finding_id UUID NOT NULL REFERENCES public.photo_findings(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('approve','reject','edit','needs_closeup','add_note')),
  previous_status TEXT,
  new_status TEXT,
  notes TEXT,
  reviewed_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.photo_finding_reviews TO authenticated;
GRANT ALL ON public.photo_finding_reviews TO service_role;
ALTER TABLE public.photo_finding_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY photo_finding_reviews_tenant_select ON public.photo_finding_reviews FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_finding_reviews.tenant_id AND uca.is_active = true));
CREATE POLICY photo_finding_reviews_tenant_insert ON public.photo_finding_reviews FOR INSERT TO authenticated
  WITH CHECK (reviewed_by = auth.uid() AND EXISTS (SELECT 1 FROM public.user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_finding_reviews.tenant_id AND uca.is_active = true));

CREATE OR REPLACE FUNCTION public.photo_finding_approval_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.review_status = 'approved' AND (OLD.review_status IS DISTINCT FROM 'approved') THEN
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION 'approved findings require approved_by';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.photo_finding_reviews r
      WHERE r.finding_id = NEW.id AND r.action = 'approve' AND r.reviewed_by = NEW.approved_by
    ) THEN
      RAISE EXCEPTION 'finding cannot be approved without a recorded human approve review';
    END IF;
    NEW.approved_at := now();
  END IF;
  IF NEW.measured_quantity IS NOT NULL AND (NEW.measurement_source IS NULL OR btrim(NEW.measurement_source) = '') THEN
    RAISE EXCEPTION 'measured quantities require a measurement_source';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER photo_finding_approval_guard BEFORE INSERT OR UPDATE ON public.photo_findings FOR EACH ROW EXECUTE FUNCTION public.photo_finding_approval_guard();
DROP POLICY IF EXISTS prc_approve ON public.photo_reference_candidates;
REVOKE UPDATE ON public.photo_reference_candidates FROM authenticated;

CREATE TABLE public.photo_proposal_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_photo_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('completed','no_useful_regions','unassessable','failed')),
  width_px integer,
  height_px integer,
  region_count integer NOT NULL DEFAULT 0,
  invalid_region_count integer NOT NULL DEFAULT 0,
  duration_ms integer,
  error text,
  segmenter_model text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.photo_proposal_runs TO authenticated;
GRANT ALL ON public.photo_proposal_runs TO service_role;
ALTER TABLE public.photo_proposal_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppr_select ON public.photo_proposal_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_proposal_runs.tenant_id));
CREATE POLICY ppr_insert ON public.photo_proposal_runs FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_proposal_runs.tenant_id));
CREATE INDEX ppr_tenant_idx ON public.photo_proposal_runs(tenant_id, source_photo_id, created_at DESC);
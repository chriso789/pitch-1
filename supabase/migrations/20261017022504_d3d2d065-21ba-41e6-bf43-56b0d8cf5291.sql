CREATE TABLE public.photo_intelligence_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID,
  version INTEGER NOT NULL,
  report JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','exported')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, version)
);
GRANT SELECT, INSERT, UPDATE ON public.photo_intelligence_reports TO authenticated;
GRANT ALL ON public.photo_intelligence_reports TO service_role;
ALTER TABLE public.photo_intelligence_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY photo_intel_reports_tenant ON public.photo_intelligence_reports FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_intelligence_reports.tenant_id AND uca.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_intelligence_reports.tenant_id AND uca.is_active = true));
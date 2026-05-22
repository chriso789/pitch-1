CREATE TABLE public.document_parser_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  parser_name TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  parser_tier TEXT NOT NULL CHECK (parser_tier IN ('deterministic','ocr','rules','ai','human')),
  vendor_type TEXT,
  document_type TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','low_confidence')),
  confidence_score NUMERIC(5,4),
  duration_ms INTEGER,
  raw_text_path TEXT,
  page_count INTEGER,
  extracted_field_count INTEGER,
  missing_fields TEXT[],
  validation_errors JSONB,
  error_message TEXT,
  triggered_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dpr_tenant_doc ON public.document_parser_runs(tenant_id, document_id, created_at DESC);
CREATE INDEX idx_dpr_status ON public.document_parser_runs(status, created_at DESC);

CREATE TABLE public.document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  vendor_type TEXT,
  parser_name TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  parser_tier TEXT NOT NULL,
  extracted_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  field_confidences JSONB DEFAULT '{}'::jsonb,
  overall_confidence NUMERIC(5,4),
  page_map_json JSONB,
  requires_review BOOLEAN NOT NULL DEFAULT false,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dext_tenant ON public.document_extractions(tenant_id, document_type);
CREATE INDEX idx_dext_review ON public.document_extractions(tenant_id, requires_review) WHERE requires_review = true;

CREATE TABLE public.document_extraction_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  extraction_id UUID NOT NULL REFERENCES public.document_extractions(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  parser_run_id UUID REFERENCES public.document_parser_runs(id) ON DELETE SET NULL,
  parser_name TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  extracted_json JSONB NOT NULL,
  field_confidences JSONB,
  overall_confidence NUMERIC(5,4),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  change_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);
CREATE INDEX idx_dev_doc ON public.document_extraction_versions(document_id, version_number DESC);

CREATE TABLE public.document_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  extraction_id UUID REFERENCES public.document_extractions(id) ON DELETE SET NULL,
  parser_run_id UUID REFERENCES public.document_parser_runs(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  reason_detail TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','dismissed')),
  assigned_to UUID,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_drq_open ON public.document_review_queue(tenant_id, status, priority DESC, created_at DESC) WHERE status IN ('open','in_review');

CREATE OR REPLACE FUNCTION public.set_document_extractions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ SET search_path = public;

CREATE TRIGGER trg_dext_updated_at BEFORE UPDATE ON public.document_extractions
  FOR EACH ROW EXECUTE FUNCTION public.set_document_extractions_updated_at();
CREATE TRIGGER trg_drq_updated_at BEFORE UPDATE ON public.document_review_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_document_extractions_updated_at();

ALTER TABLE public.document_parser_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_extraction_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read parser runs" ON public.document_parser_runs
  FOR SELECT USING (tenant_id IN (
    SELECT uca.tenant_id FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
  ));
CREATE POLICY "tenant members read extractions" ON public.document_extractions
  FOR SELECT USING (tenant_id IN (
    SELECT uca.tenant_id FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
  ));
CREATE POLICY "tenant members read versions" ON public.document_extraction_versions
  FOR SELECT USING (tenant_id IN (
    SELECT uca.tenant_id FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
  ));
CREATE POLICY "tenant members read review queue" ON public.document_review_queue
  FOR SELECT USING (tenant_id IN (
    SELECT uca.tenant_id FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
  ));

CREATE POLICY "tenant elevated update review queue" ON public.document_review_queue
  FOR UPDATE USING (tenant_id IN (
    SELECT uca.tenant_id FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid() AND uca.is_active = true
      AND uca.access_level IN ('owner','admin','manager','master')
  ));
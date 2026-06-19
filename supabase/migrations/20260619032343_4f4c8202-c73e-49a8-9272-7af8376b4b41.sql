
CREATE TABLE IF NOT EXISTS public.ai_document_extractions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  pipeline_entry_id uuid null,
  contact_id uuid null,
  lead_id uuid null,
  job_id uuid null,
  extraction_status text not null default 'pending',
  document_class text not null default 'unknown',
  confidence numeric null,
  extracted_fields jsonb not null default '{}'::jsonb,
  normalized_fields jsonb not null default '{}'::jsonb,
  validation_flags jsonb not null default '[]'::jsonb,
  source_text_hash text null,
  model_name text null,
  model_version text null,
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_ai_doc_extr_tenant ON public.ai_document_extractions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_doc_extr_document ON public.ai_document_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_ai_doc_extr_pipeline ON public.ai_document_extractions(pipeline_entry_id);
CREATE INDEX IF NOT EXISTS idx_ai_doc_extr_class ON public.ai_document_extractions(document_class);
CREATE INDEX IF NOT EXISTS idx_ai_doc_extr_status ON public.ai_document_extractions(extraction_status);
CREATE INDEX IF NOT EXISTS idx_ai_doc_extr_extracted_gin ON public.ai_document_extractions USING gin(extracted_fields);
CREATE INDEX IF NOT EXISTS idx_ai_doc_extr_normalized_gin ON public.ai_document_extractions USING gin(normalized_fields);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_document_extractions TO authenticated;
GRANT ALL ON public.ai_document_extractions TO service_role;

ALTER TABLE public.ai_document_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view their extractions"
  ON public.ai_document_extractions FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "Tenant users can insert their extractions"
  ON public.ai_document_extractions FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "Tenant users can update their extractions"
  ON public.ai_document_extractions FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "Tenant users can delete their extractions"
  ON public.ai_document_extractions FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE TRIGGER trg_ai_doc_extr_updated_at
  BEFORE UPDATE ON public.ai_document_extractions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

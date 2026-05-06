
-- PDF Templates for reusable documents
CREATE TABLE IF NOT EXISTS public.pdf_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source_document_id UUID REFERENCES public.pdf_documents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  smart_tags JSONB DEFAULT '[]',
  category TEXT DEFAULT 'general',
  is_active BOOLEAN DEFAULT true,
  original_file_path TEXT,
  page_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.pdf_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users manage templates"
  ON public.pdf_templates FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

-- Form fields detected/defined on PDF documents
CREATE TABLE IF NOT EXISTS public.pdf_form_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id UUID NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  page_id UUID REFERENCES public.pdf_engine_pages(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  field_value TEXT,
  bounds JSONB NOT NULL DEFAULT '{}',
  options JSONB DEFAULT '{}',
  is_required BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.pdf_form_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Form fields follow document access"
  ON public.pdf_form_fields FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pdf_documents pd
      WHERE pd.id = pdf_form_fields.pdf_document_id
      AND pd.tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pdf_documents pd
      WHERE pd.id = pdf_form_fields.pdf_document_id
      AND pd.tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid())
    )
  );

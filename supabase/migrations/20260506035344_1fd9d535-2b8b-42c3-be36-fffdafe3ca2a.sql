
-- PDF Fonts table
CREATE TABLE IF NOT EXISTS public.pdf_fonts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id UUID REFERENCES public.pdf_documents(id) ON DELETE CASCADE NOT NULL,
  font_name TEXT,
  font_family TEXT,
  embedded BOOLEAN DEFAULT false,
  subset BOOLEAN DEFAULT false,
  font_metadata JSONB DEFAULT '{}',
  replacement_font TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.pdf_fonts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can manage pdf_fonts"
  ON public.pdf_fonts FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.pdf_documents pd WHERE pd.id = pdf_document_id AND pd.tenant_id IN (
      SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()
    ))
  );

-- PDF Smart Fields table
CREATE TABLE IF NOT EXISTS public.pdf_smart_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.pdf_templates(id) ON DELETE CASCADE,
  page_id UUID REFERENCES public.pdf_engine_pages(id) ON DELETE SET NULL,
  object_id UUID REFERENCES public.pdf_engine_objects(id) ON DELETE SET NULL,
  field_key TEXT NOT NULL,
  placeholder_text TEXT,
  bounds JSONB,
  replacement_rules JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.pdf_smart_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can manage pdf_smart_fields"
  ON public.pdf_smart_fields FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.pdf_templates pt WHERE pt.id = template_id AND pt.tenant_id IN (
      SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()
    ))
  );

-- PDF Search Index
CREATE TABLE IF NOT EXISTS public.pdf_search_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id UUID REFERENCES public.pdf_documents(id) ON DELETE CASCADE NOT NULL,
  page_id UUID REFERENCES public.pdf_engine_pages(id) ON DELETE SET NULL,
  object_id UUID REFERENCES public.pdf_engine_objects(id) ON DELETE SET NULL,
  searchable_text TEXT,
  tsv TSVECTOR
);

CREATE INDEX IF NOT EXISTS idx_pdf_search_tsv ON public.pdf_search_index USING gin(tsv);
CREATE INDEX IF NOT EXISTS idx_pdf_search_doc ON public.pdf_search_index(pdf_document_id);

ALTER TABLE public.pdf_search_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can access pdf_search_index"
  ON public.pdf_search_index FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.pdf_documents pd WHERE pd.id = pdf_document_id AND pd.tenant_id IN (
      SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()
    ))
  );

-- Auto-generate tsvector on insert/update
CREATE OR REPLACE FUNCTION public.pdf_search_index_tsv_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.tsv := to_tsvector('english', COALESCE(NEW.searchable_text, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pdf_search_tsv ON public.pdf_search_index;
CREATE TRIGGER trg_pdf_search_tsv
  BEFORE INSERT OR UPDATE ON public.pdf_search_index
  FOR EACH ROW EXECUTE FUNCTION public.pdf_search_index_tsv_trigger();

-- PDF Collab Sessions
CREATE TABLE IF NOT EXISTS public.pdf_collab_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id UUID REFERENCES public.pdf_documents(id) ON DELETE CASCADE NOT NULL,
  session_key TEXT NOT NULL UNIQUE,
  participants JSONB DEFAULT '[]',
  operation_stream JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.pdf_collab_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can manage pdf_collab_sessions"
  ON public.pdf_collab_sessions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.pdf_documents pd WHERE pd.id = pdf_document_id AND pd.tenant_id IN (
      SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid()
    ))
  );

-- Add columns to pdf_templates if missing
ALTER TABLE public.pdf_templates
  ADD COLUMN IF NOT EXISTS layout_graph JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reusable BOOLEAN DEFAULT true;

-- Add columns to pdf_form_fields if missing
ALTER TABLE public.pdf_form_fields
  ADD COLUMN IF NOT EXISTS readonly BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS required BOOLEAN DEFAULT false;

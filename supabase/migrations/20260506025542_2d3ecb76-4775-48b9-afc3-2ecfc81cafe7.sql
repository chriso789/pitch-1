
-- ========================================
-- PDF Documents: master record
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_document_id uuid NULL,
  title text NOT NULL,
  original_file_path text NOT NULL,
  current_version_id uuid NULL,
  page_count integer DEFAULT 0,
  status text DEFAULT 'draft' CHECK (status IN ('draft','parsed','editing','compiled','finalized')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pdf_documents_tenant ON public.pdf_documents(tenant_id);
ALTER TABLE public.pdf_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_documents"
  ON public.pdf_documents FOR ALL
  USING (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid));

-- ========================================
-- PDF Engine Pages
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_engine_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id uuid NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  page_number integer NOT NULL,
  width numeric(10,2),
  height numeric(10,2),
  rotation integer DEFAULT 0,
  thumbnail_path text,
  render_path text,
  extracted_text text,
  metadata jsonb DEFAULT '{}'::jsonb,
  UNIQUE(pdf_document_id, page_number)
);

CREATE INDEX idx_pdf_engine_pages_doc ON public.pdf_engine_pages(pdf_document_id);
ALTER TABLE public.pdf_engine_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_engine_pages"
  ON public.pdf_engine_pages FOR ALL
  USING (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)))
  WITH CHECK (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)));

-- ========================================
-- PDF Engine Objects: editable object graph
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_engine_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id uuid NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.pdf_engine_pages(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type IN ('text','image','vector','annotation','form_field','signature','redaction')),
  object_key text NOT NULL,
  bounds jsonb NOT NULL DEFAULT '{}'::jsonb,
  transform jsonb DEFAULT '{}'::jsonb,
  content jsonb DEFAULT '{}'::jsonb,
  font_info jsonb DEFAULT '{}'::jsonb,
  z_index integer DEFAULT 0,
  is_editable boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pdf_engine_objects_doc ON public.pdf_engine_objects(pdf_document_id);
CREATE INDEX idx_pdf_engine_objects_page ON public.pdf_engine_objects(page_id);
ALTER TABLE public.pdf_engine_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_engine_objects"
  ON public.pdf_engine_objects FOR ALL
  USING (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)))
  WITH CHECK (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)));

-- ========================================
-- PDF Engine Operations: edit history
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_engine_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id uuid NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.pdf_engine_pages(id) ON DELETE SET NULL,
  operation_type text NOT NULL CHECK (operation_type IN (
    'replace_text','add_text','move_object','delete_object',
    'rotate_page','reorder_page','insert_page','delete_page',
    'add_annotation','remove_annotation',
    'add_redaction','apply_redaction',
    'add_signature','update_form_field'
  )),
  target_object_id uuid REFERENCES public.pdf_engine_objects(id) ON DELETE SET NULL,
  operation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_undone boolean DEFAULT false,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pdf_engine_operations_doc ON public.pdf_engine_operations(pdf_document_id, created_at);
ALTER TABLE public.pdf_engine_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_engine_operations"
  ON public.pdf_engine_operations FOR ALL
  USING (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)))
  WITH CHECK (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)));

-- ========================================
-- PDF Engine Versions
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_engine_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id uuid NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  compiled_file_path text,
  operation_count integer DEFAULT 0,
  snapshot jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  UNIQUE(pdf_document_id, version_number)
);

ALTER TABLE public.pdf_engine_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_engine_versions"
  ON public.pdf_engine_versions FOR ALL
  USING (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)))
  WITH CHECK (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)));

-- Add FK from pdf_documents.current_version_id
ALTER TABLE public.pdf_documents
  ADD CONSTRAINT fk_pdf_documents_current_version
  FOREIGN KEY (current_version_id) REFERENCES public.pdf_engine_versions(id) ON DELETE SET NULL;

-- ========================================
-- PDF Engine Annotations
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_engine_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id uuid NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.pdf_engine_pages(id) ON DELETE CASCADE,
  annotation_type text,
  annotation_data jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.pdf_engine_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_engine_annotations"
  ON public.pdf_engine_annotations FOR ALL
  USING (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)))
  WITH CHECK (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)));

-- ========================================
-- PDF Engine Render Cache
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_engine_render_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_document_id uuid NOT NULL REFERENCES public.pdf_documents(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.pdf_engine_pages(id) ON DELETE CASCADE,
  render_scale numeric(4,2),
  image_path text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.pdf_engine_render_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_engine_render_cache"
  ON public.pdf_engine_render_cache FOR ALL
  USING (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)))
  WITH CHECK (pdf_document_id IN (SELECT id FROM public.pdf_documents WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)));

-- ========================================
-- Storage Buckets
-- ========================================
INSERT INTO storage.buckets (id, name, public) VALUES ('pdf-originals', 'pdf-originals', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('pdf-renders', 'pdf-renders', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('pdf-thumbnails', 'pdf-thumbnails', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('pdf-compiled', 'pdf-compiled', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('pdf-cache', 'pdf-cache', false) ON CONFLICT (id) DO NOTHING;

-- Storage RLS for all PDF buckets (tenant_id as first folder)
CREATE POLICY "Tenant access pdf-originals" ON storage.objects FOR ALL
  USING (bucket_id = 'pdf-originals' AND (storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id'))
  WITH CHECK (bucket_id = 'pdf-originals' AND (storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id'));

CREATE POLICY "Tenant access pdf-renders" ON storage.objects FOR ALL
  USING (bucket_id = 'pdf-renders' AND (storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id'))
  WITH CHECK (bucket_id = 'pdf-renders' AND (storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id'));

CREATE POLICY "Tenant access pdf-thumbnails" ON storage.objects FOR ALL
  USING (bucket_id = 'pdf-thumbnails' AND (storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id'))
  WITH CHECK (bucket_id = 'pdf-thumbnails' AND (storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id'));

CREATE POLICY "Tenant access pdf-compiled" ON storage.objects FOR ALL
  USING (bucket_id = 'pdf-compiled' AND (storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id'))
  WITH CHECK (bucket_id = 'pdf-compiled' AND (storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id'));

CREATE POLICY "Tenant access pdf-cache" ON storage.objects FOR ALL
  USING (bucket_id = 'pdf-cache' AND (storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id'))
  WITH CHECK (bucket_id = 'pdf-cache' AND (storage.foldername(name))[1] = (auth.jwt()->'app_metadata'->>'tenant_id'));

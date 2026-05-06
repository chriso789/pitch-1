
-- ========================================
-- PDF Pages: per-page metadata & text layer
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_document_id uuid NOT NULL REFERENCES public.pdf_workspace_documents(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  page_number integer NOT NULL,
  width numeric(10,2),
  height numeric(10,2),
  rotation integer DEFAULT 0,
  text_layer jsonb DEFAULT '[]'::jsonb,
  thumbnail_path text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(workspace_document_id, page_number)
);

ALTER TABLE public.pdf_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_pages"
  ON public.pdf_pages FOR ALL
  USING (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid));

-- ========================================
-- PDF Objects: the editable object graph
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.pdf_pages(id) ON DELETE CASCADE,
  workspace_document_id uuid NOT NULL REFERENCES public.pdf_workspace_documents(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  object_type text NOT NULL CHECK (object_type IN ('text','image','vector','annotation','form_field','signature')),
  x numeric(10,2) NOT NULL DEFAULT 0,
  y numeric(10,2) NOT NULL DEFAULT 0,
  width numeric(10,2),
  height numeric(10,2),
  rotation numeric(6,2) DEFAULT 0,
  content text,
  font_family text,
  font_size numeric(6,2),
  font_weight text,
  font_color text,
  opacity numeric(4,2) DEFAULT 1.0,
  z_index integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  is_deleted boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pdf_objects_page ON public.pdf_objects(page_id) WHERE NOT is_deleted;
CREATE INDEX idx_pdf_objects_doc ON public.pdf_objects(workspace_document_id) WHERE NOT is_deleted;

ALTER TABLE public.pdf_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_objects"
  ON public.pdf_objects FOR ALL
  USING (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid));

-- ========================================
-- PDF Operations: instruction-based edit history
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_document_id uuid NOT NULL REFERENCES public.pdf_workspace_documents(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  sequence_number bigint NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN (
    'insert_text','replace_text','delete_text',
    'move_object','resize_object','rotate_object',
    'insert_image','delete_object',
    'add_annotation','delete_annotation',
    'add_redaction','apply_redaction',
    'rotate_page','delete_page','insert_page','reorder_pages',
    'smart_tag_replace','ai_rewrite',
    'add_signature','add_form_field',
    'batch'
  )),
  target_object_id uuid REFERENCES public.pdf_objects(id) ON DELETE SET NULL,
  target_page_id uuid REFERENCES public.pdf_pages(id) ON DELETE SET NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_undone boolean DEFAULT false,
  actor_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(workspace_document_id, sequence_number)
);

CREATE INDEX idx_pdf_operations_doc_seq ON public.pdf_operations(workspace_document_id, sequence_number);

ALTER TABLE public.pdf_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read for pdf_operations"
  ON public.pdf_operations FOR SELECT
  USING (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid));

CREATE POLICY "Tenant insert for pdf_operations"
  ON public.pdf_operations FOR INSERT
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid));

-- Allow marking operations as undone
CREATE POLICY "Tenant update undo for pdf_operations"
  ON public.pdf_operations FOR UPDATE
  USING (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid));

-- ========================================
-- PDF Redactions: tracked redaction areas
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_redactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_document_id uuid NOT NULL REFERENCES public.pdf_workspace_documents(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.pdf_pages(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  x numeric(10,2) NOT NULL,
  y numeric(10,2) NOT NULL,
  width numeric(10,2) NOT NULL,
  height numeric(10,2) NOT NULL,
  reason text,
  applied boolean DEFAULT false,
  applied_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.pdf_redactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_redactions"
  ON public.pdf_redactions FOR ALL
  USING (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid));

-- ========================================
-- PDF Render Cache: pre-rendered page snapshots
-- ========================================
CREATE TABLE IF NOT EXISTS public.pdf_render_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_document_id uuid NOT NULL REFERENCES public.pdf_workspace_documents(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  page_number integer NOT NULL,
  version_number integer NOT NULL,
  render_path text NOT NULL,
  render_format text DEFAULT 'jpeg',
  scale numeric(4,2) DEFAULT 1.5,
  created_at timestamptz DEFAULT now(),
  UNIQUE(workspace_document_id, page_number, version_number, scale)
);

ALTER TABLE public.pdf_render_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for pdf_render_cache"
  ON public.pdf_render_cache FOR ALL
  USING (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid));

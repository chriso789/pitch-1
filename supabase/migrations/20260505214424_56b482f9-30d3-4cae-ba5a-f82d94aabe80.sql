
-- Indexes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_pdf_ws_docs_tenant ON public.pdf_workspace_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pdf_ws_docs_status ON public.pdf_workspace_documents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_pdf_ws_versions_doc ON public.pdf_workspace_versions(workspace_document_id);
CREATE INDEX IF NOT EXISTS idx_pdf_ws_annotations_doc ON public.pdf_workspace_annotations(workspace_document_id);
CREATE INDEX IF NOT EXISTS idx_pdf_ws_ai_edits_doc ON public.pdf_workspace_ai_edits(workspace_document_id);
CREATE INDEX IF NOT EXISTS idx_pdf_ws_audit_doc ON public.pdf_workspace_audit_events(workspace_document_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_pdf_workspace_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Drop triggers if they exist then recreate
DROP TRIGGER IF EXISTS trg_pdf_ws_docs_updated_at ON public.pdf_workspace_documents;
CREATE TRIGGER trg_pdf_ws_docs_updated_at
  BEFORE UPDATE ON public.pdf_workspace_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_pdf_workspace_updated_at();

DROP TRIGGER IF EXISTS trg_pdf_ws_annotations_updated_at ON public.pdf_workspace_annotations;
CREATE TRIGGER trg_pdf_ws_annotations_updated_at
  BEFORE UPDATE ON public.pdf_workspace_annotations
  FOR EACH ROW EXECUTE FUNCTION public.update_pdf_workspace_updated_at();

-- RLS
ALTER TABLE public.pdf_workspace_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_workspace_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_workspace_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_workspace_ai_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_workspace_audit_events ENABLE ROW LEVEL SECURITY;

-- Security definer function
CREATE OR REPLACE FUNCTION public.get_pdf_ws_tenant_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(active_tenant_id, tenant_id)
  FROM public.profiles
  WHERE id = _user_id
  LIMIT 1
$$;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "pdf_ws_docs_select" ON public.pdf_workspace_documents;
DROP POLICY IF EXISTS "pdf_ws_docs_insert" ON public.pdf_workspace_documents;
DROP POLICY IF EXISTS "pdf_ws_docs_update" ON public.pdf_workspace_documents;
DROP POLICY IF EXISTS "pdf_ws_docs_delete" ON public.pdf_workspace_documents;

CREATE POLICY "pdf_ws_docs_select" ON public.pdf_workspace_documents
  FOR SELECT TO authenticated USING (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));
CREATE POLICY "pdf_ws_docs_insert" ON public.pdf_workspace_documents
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));
CREATE POLICY "pdf_ws_docs_update" ON public.pdf_workspace_documents
  FOR UPDATE TO authenticated USING (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));
CREATE POLICY "pdf_ws_docs_delete" ON public.pdf_workspace_documents
  FOR DELETE TO authenticated USING (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "pdf_ws_ver_select" ON public.pdf_workspace_versions;
DROP POLICY IF EXISTS "pdf_ws_ver_insert" ON public.pdf_workspace_versions;

CREATE POLICY "pdf_ws_ver_select" ON public.pdf_workspace_versions
  FOR SELECT TO authenticated USING (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));
CREATE POLICY "pdf_ws_ver_insert" ON public.pdf_workspace_versions
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "pdf_ws_ann_select" ON public.pdf_workspace_annotations;
DROP POLICY IF EXISTS "pdf_ws_ann_insert" ON public.pdf_workspace_annotations;
DROP POLICY IF EXISTS "pdf_ws_ann_update" ON public.pdf_workspace_annotations;

CREATE POLICY "pdf_ws_ann_select" ON public.pdf_workspace_annotations
  FOR SELECT TO authenticated USING (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));
CREATE POLICY "pdf_ws_ann_insert" ON public.pdf_workspace_annotations
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));
CREATE POLICY "pdf_ws_ann_update" ON public.pdf_workspace_annotations
  FOR UPDATE TO authenticated USING (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "pdf_ws_ai_select" ON public.pdf_workspace_ai_edits;
DROP POLICY IF EXISTS "pdf_ws_ai_insert" ON public.pdf_workspace_ai_edits;
DROP POLICY IF EXISTS "pdf_ws_ai_update" ON public.pdf_workspace_ai_edits;

CREATE POLICY "pdf_ws_ai_select" ON public.pdf_workspace_ai_edits
  FOR SELECT TO authenticated USING (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));
CREATE POLICY "pdf_ws_ai_insert" ON public.pdf_workspace_ai_edits
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));
CREATE POLICY "pdf_ws_ai_update" ON public.pdf_workspace_ai_edits
  FOR UPDATE TO authenticated USING (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "pdf_ws_audit_select" ON public.pdf_workspace_audit_events;
DROP POLICY IF EXISTS "pdf_ws_audit_insert" ON public.pdf_workspace_audit_events;

CREATE POLICY "pdf_ws_audit_select" ON public.pdf_workspace_audit_events
  FOR SELECT TO authenticated USING (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));
CREATE POLICY "pdf_ws_audit_insert" ON public.pdf_workspace_audit_events
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_pdf_ws_tenant_id(auth.uid()));

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('pdf-originals', 'pdf-originals', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('pdf-working', 'pdf-working', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('pdf-finalized', 'pdf-finalized', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('pdf-thumbnails', 'pdf-thumbnails', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('pdf-exports', 'pdf-exports', false) ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "pdf_orig_select" ON storage.objects;
DROP POLICY IF EXISTS "pdf_orig_insert" ON storage.objects;
DROP POLICY IF EXISTS "pdf_working_select" ON storage.objects;
DROP POLICY IF EXISTS "pdf_working_insert" ON storage.objects;
DROP POLICY IF EXISTS "pdf_working_update" ON storage.objects;
DROP POLICY IF EXISTS "pdf_finalized_select" ON storage.objects;
DROP POLICY IF EXISTS "pdf_finalized_insert" ON storage.objects;
DROP POLICY IF EXISTS "pdf_thumbs_select" ON storage.objects;
DROP POLICY IF EXISTS "pdf_thumbs_insert" ON storage.objects;
DROP POLICY IF EXISTS "pdf_exports_select" ON storage.objects;
DROP POLICY IF EXISTS "pdf_exports_insert" ON storage.objects;

CREATE POLICY "pdf_orig_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pdf-originals' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);
CREATE POLICY "pdf_orig_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pdf-originals' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);

CREATE POLICY "pdf_working_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pdf-working' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);
CREATE POLICY "pdf_working_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pdf-working' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);
CREATE POLICY "pdf_working_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pdf-working' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);

CREATE POLICY "pdf_finalized_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pdf-finalized' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);
CREATE POLICY "pdf_finalized_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pdf-finalized' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);

CREATE POLICY "pdf_thumbs_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pdf-thumbnails' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);
CREATE POLICY "pdf_thumbs_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pdf-thumbnails' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);

CREATE POLICY "pdf_exports_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pdf-exports' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);
CREATE POLICY "pdf_exports_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pdf-exports' AND (storage.foldername(name))[1] = public.get_pdf_ws_tenant_id(auth.uid())::text);


DO $$ BEGIN
  CREATE TYPE public.plan_page_type AS ENUM (
    'roof_plan','detail_sheet','specification_sheet','section_sheet',
    'schedule_sheet','cover_sheet','framing_plan','irrelevant','unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.plan_doc_status AS ENUM (
    'uploaded','classifying','extracting_geometry','extracting_specs',
    'linking_details','ready_for_review','approved','rejected','failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.plan_geometry_class AS ENUM (
    'outline','eave','rake','ridge','hip','valley','facet','penetration','drain','dimension_line','callout_leader','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.plan_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  uploaded_by uuid,
  contact_id uuid,
  pipeline_entry_id uuid,
  project_id uuid,
  property_address text,
  file_name text NOT NULL,
  file_path text NOT NULL,
  page_count integer DEFAULT 0,
  status public.plan_doc_status NOT NULL DEFAULT 'uploaded',
  status_message text,
  approved_at timestamptz,
  approved_by uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_documents_tenant ON public.plan_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_documents_status ON public.plan_documents(status);
CREATE INDEX IF NOT EXISTS idx_plan_documents_contact ON public.plan_documents(contact_id);
ALTER TABLE public.plan_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_documents tenant all" ON public.plan_documents;
CREATE POLICY "plan_documents tenant all" ON public.plan_documents
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TABLE IF NOT EXISTS public.plan_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.plan_documents(id) ON DELETE CASCADE,
  page_number integer NOT NULL,
  page_type public.plan_page_type NOT NULL DEFAULT 'unknown',
  page_type_confidence numeric,
  sheet_name text,
  sheet_number text,
  scale_text text,
  north_arrow_deg numeric,
  image_path text,
  width_px integer,
  height_px integer,
  raw_text text,
  ai_summary text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, page_number)
);
CREATE INDEX IF NOT EXISTS idx_plan_pages_tenant ON public.plan_pages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_pages_doc ON public.plan_pages(document_id);
CREATE INDEX IF NOT EXISTS idx_plan_pages_type ON public.plan_pages(page_type);
ALTER TABLE public.plan_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_pages tenant all" ON public.plan_pages;
CREATE POLICY "plan_pages tenant all" ON public.plan_pages
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TABLE IF NOT EXISTS public.plan_geometry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  page_id uuid NOT NULL REFERENCES public.plan_pages(id) ON DELETE CASCADE,
  geometry_class public.plan_geometry_class NOT NULL,
  points jsonb NOT NULL,
  length_px numeric,
  length_ft numeric,
  confidence numeric,
  source text DEFAULT 'ai_vision',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_geometry_tenant ON public.plan_geometry(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_geometry_page ON public.plan_geometry(page_id);
CREATE INDEX IF NOT EXISTS idx_plan_geometry_class ON public.plan_geometry(geometry_class);
ALTER TABLE public.plan_geometry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_geometry tenant all" ON public.plan_geometry;
CREATE POLICY "plan_geometry tenant all" ON public.plan_geometry
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TABLE IF NOT EXISTS public.plan_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  page_id uuid NOT NULL REFERENCES public.plan_pages(id) ON DELETE CASCADE,
  label_text text NOT NULL,
  normalized_feet numeric,
  source_geometry_id uuid REFERENCES public.plan_geometry(id) ON DELETE SET NULL,
  bbox jsonb,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_dimensions_tenant ON public.plan_dimensions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_dimensions_page ON public.plan_dimensions(page_id);
ALTER TABLE public.plan_dimensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_dimensions tenant all" ON public.plan_dimensions;
CREATE POLICY "plan_dimensions tenant all" ON public.plan_dimensions
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TABLE IF NOT EXISTS public.plan_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.plan_documents(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.plan_pages(id) ON DELETE SET NULL,
  category text NOT NULL,
  key_name text NOT NULL,
  value_text text,
  normalized_value jsonb,
  confidence numeric,
  approved boolean DEFAULT false,
  edited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_specs_tenant ON public.plan_specs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_specs_doc ON public.plan_specs(document_id);
CREATE INDEX IF NOT EXISTS idx_plan_specs_category ON public.plan_specs(category);
ALTER TABLE public.plan_specs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_specs tenant all" ON public.plan_specs;
CREATE POLICY "plan_specs tenant all" ON public.plan_specs
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TABLE IF NOT EXISTS public.plan_detail_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.plan_documents(id) ON DELETE CASCADE,
  source_page_id uuid REFERENCES public.plan_pages(id) ON DELETE CASCADE,
  target_page_id uuid REFERENCES public.plan_pages(id) ON DELETE SET NULL,
  callout_text text NOT NULL,
  target_sheet_number text,
  target_geometry_ref uuid REFERENCES public.plan_geometry(id) ON DELETE SET NULL,
  confidence numeric,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_detail_refs_tenant ON public.plan_detail_refs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_detail_refs_doc ON public.plan_detail_refs(document_id);
ALTER TABLE public.plan_detail_refs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_detail_refs tenant all" ON public.plan_detail_refs;
CREATE POLICY "plan_detail_refs tenant all" ON public.plan_detail_refs
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TABLE IF NOT EXISTS public.plan_review_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.plan_documents(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.plan_pages(id) ON DELETE SET NULL,
  user_id uuid,
  action text NOT NULL,
  target_table text,
  target_id uuid,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_review_actions_tenant ON public.plan_review_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_review_actions_doc ON public.plan_review_actions(document_id);
ALTER TABLE public.plan_review_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_review_actions tenant all" ON public.plan_review_actions;
CREATE POLICY "plan_review_actions tenant all" ON public.plan_review_actions
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE OR REPLACE FUNCTION public.plan_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS plan_documents_touch ON public.plan_documents;
CREATE TRIGGER plan_documents_touch BEFORE UPDATE ON public.plan_documents
  FOR EACH ROW EXECUTE FUNCTION public.plan_touch_updated_at();
DROP TRIGGER IF EXISTS plan_pages_touch ON public.plan_pages;
CREATE TRIGGER plan_pages_touch BEFORE UPDATE ON public.plan_pages
  FOR EACH ROW EXECUTE FUNCTION public.plan_touch_updated_at();
DROP TRIGGER IF EXISTS plan_specs_touch ON public.plan_specs;
CREATE TRIGGER plan_specs_touch BEFORE UPDATE ON public.plan_specs
  FOR EACH ROW EXECUTE FUNCTION public.plan_touch_updated_at();

INSERT INTO storage.buckets (id, name, public)
VALUES ('blueprints', 'blueprints', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "blueprints tenant read" ON storage.objects;
CREATE POLICY "blueprints tenant read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'blueprints'
    AND (storage.foldername(name))[1]::uuid = public.get_user_tenant_id()
  );
DROP POLICY IF EXISTS "blueprints tenant insert" ON storage.objects;
CREATE POLICY "blueprints tenant insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'blueprints'
    AND (storage.foldername(name))[1]::uuid = public.get_user_tenant_id()
  );
DROP POLICY IF EXISTS "blueprints tenant update" ON storage.objects;
CREATE POLICY "blueprints tenant update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'blueprints'
    AND (storage.foldername(name))[1]::uuid = public.get_user_tenant_id()
  );
DROP POLICY IF EXISTS "blueprints tenant delete" ON storage.objects;
CREATE POLICY "blueprints tenant delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'blueprints'
    AND (storage.foldername(name))[1]::uuid = public.get_user_tenant_id()
  );

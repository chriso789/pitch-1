-- Blueprint F1C/F1D viewport + reference graph storage.
-- Additive only; does not create measurement or estimate outputs.

CREATE TABLE IF NOT EXISTS public.plan_drawing_viewports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.plan_documents(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.plan_pages(id) ON DELETE CASCADE,
  viewport_key text NOT NULL,
  title text,
  bbox jsonb NOT NULL,
  scale_json jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  source text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_drawing_viewports_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT plan_drawing_viewports_review_chk CHECK (review_status IN ('pending','confirmed','rejected')),
  UNIQUE (document_id, viewport_key)
);

CREATE INDEX IF NOT EXISTS idx_plan_drawing_viewports_tenant
  ON public.plan_drawing_viewports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_drawing_viewports_document
  ON public.plan_drawing_viewports(document_id);
CREATE INDEX IF NOT EXISTS idx_plan_drawing_viewports_page
  ON public.plan_drawing_viewports(page_id);

ALTER TABLE public.plan_drawing_viewports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_drawing_viewports tenant all" ON public.plan_drawing_viewports;
CREATE POLICY "plan_drawing_viewports tenant all" ON public.plan_drawing_viewports
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP TRIGGER IF EXISTS plan_drawing_viewports_touch ON public.plan_drawing_viewports;
CREATE TRIGGER plan_drawing_viewports_touch
  BEFORE UPDATE ON public.plan_drawing_viewports
  FOR EACH ROW EXECUTE FUNCTION public.plan_touch_updated_at();

ALTER TABLE public.plan_detail_refs
  ADD COLUMN IF NOT EXISTS source_viewport_key text,
  ADD COLUMN IF NOT EXISTS detail_number text,
  ADD COLUMN IF NOT EXISTS reference_type text,
  ADD COLUMN IF NOT EXISTS bbox jsonb,
  ADD COLUMN IF NOT EXISTS version text;

CREATE INDEX IF NOT EXISTS idx_plan_detail_refs_target_sheet
  ON public.plan_detail_refs(document_id, target_sheet_number);
CREATE INDEX IF NOT EXISTS idx_plan_detail_refs_source_viewport
  ON public.plan_detail_refs(document_id, source_viewport_key);

COMMENT ON TABLE public.plan_drawing_viewports IS
  'Coordinate-aware drawing/detail regions detected within blueprint sheets. Viewports are evidence containers, not approved measurements.';
COMMENT ON COLUMN public.plan_detail_refs.source_viewport_key IS
  'Stable F1 viewport key identifying the drawing region that emitted the reference.';

NOTIFY pgrst, 'reload schema';

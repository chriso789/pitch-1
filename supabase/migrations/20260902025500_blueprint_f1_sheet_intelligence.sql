-- Blueprint F1 sheet-intelligence storage.
-- Additive only: preserves all existing plan_* and blueprint_* behavior.

ALTER TABLE public.plan_pages
  ADD COLUMN IF NOT EXISTS width_points numeric,
  ADD COLUMN IF NOT EXISTS height_points numeric,
  ADD COLUMN IF NOT EXISTS layout_version text,
  ADD COLUMN IF NOT EXISTS layout_extraction_status text,
  ADD COLUMN IF NOT EXISTS layout_json jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.plan_sheet_index_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.plan_documents(id) ON DELETE CASCADE,
  source_page_id uuid REFERENCES public.plan_pages(id) ON DELETE SET NULL,
  sheet_number text NOT NULL,
  sheet_title text,
  discipline text NOT NULL DEFAULT 'unknown',
  confidence numeric NOT NULL DEFAULT 0,
  source_text text,
  bbox jsonb,
  status text NOT NULL DEFAULT 'detected',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_sheet_index_confidence_chk CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT plan_sheet_index_status_chk CHECK (status IN ('detected','confirmed','missing','dismissed')),
  UNIQUE (document_id, sheet_number)
);

CREATE INDEX IF NOT EXISTS idx_plan_sheet_index_entries_tenant
  ON public.plan_sheet_index_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_sheet_index_entries_document
  ON public.plan_sheet_index_entries(document_id);
CREATE INDEX IF NOT EXISTS idx_plan_sheet_index_entries_sheet
  ON public.plan_sheet_index_entries(document_id, sheet_number);

ALTER TABLE public.plan_sheet_index_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_sheet_index_entries tenant all" ON public.plan_sheet_index_entries;
CREATE POLICY "plan_sheet_index_entries tenant all" ON public.plan_sheet_index_entries
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP TRIGGER IF EXISTS plan_sheet_index_entries_touch ON public.plan_sheet_index_entries;
CREATE TRIGGER plan_sheet_index_entries_touch
  BEFORE UPDATE ON public.plan_sheet_index_entries
  FOR EACH ROW EXECUTE FUNCTION public.plan_touch_updated_at();

COMMENT ON COLUMN public.plan_pages.layout_json IS
  'Coordinate-preserving deterministic PDF page layout. F1 contract; not itself an approved measurement source.';
COMMENT ON TABLE public.plan_sheet_index_entries IS
  'Normalized sheet-index rows extracted from construction drawing cover/index sheets; tenant-scoped and reviewable.';

NOTIFY pgrst, 'reload schema';

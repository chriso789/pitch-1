-- Blueprint F1E/F1F additive provenance fields.
-- Existing plan_specs / plan_dimensions remain canonical stores.

ALTER TABLE public.plan_specs
  ADD COLUMN IF NOT EXISTS source_text text,
  ADD COLUMN IF NOT EXISTS bbox jsonb,
  ADD COLUMN IF NOT EXISTS source_viewport_key text,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'deterministic_pdf_text',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'detected';

ALTER TABLE public.plan_dimensions
  ADD COLUMN IF NOT EXISTS source_text text,
  ADD COLUMN IF NOT EXISTS source_viewport_key text,
  ADD COLUMN IF NOT EXISTS scale_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'explicit_dimension_text',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'detected';

DO $$ BEGIN
  ALTER TABLE public.plan_specs
    ADD CONSTRAINT plan_specs_status_chk CHECK (status IN ('detected','confirmed','dismissed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.plan_dimensions
    ADD CONSTRAINT plan_dimensions_status_chk CHECK (status IN ('detected','confirmed','dismissed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_plan_specs_viewport ON public.plan_specs(document_id, source_viewport_key);
CREATE INDEX IF NOT EXISTS idx_plan_dimensions_viewport ON public.plan_dimensions(page_id, source_viewport_key);

COMMENT ON COLUMN public.plan_specs.source_text IS 'Exact deterministic PDF text evidence used to create this specification candidate.';
COMMENT ON COLUMN public.plan_dimensions.scale_snapshot IS 'Viewport scale evidence captured when dimension/geometry candidate was created; null for explicit dimension text when scale is unnecessary.';

NOTIFY pgrst, 'reload schema';

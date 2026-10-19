CREATE TABLE public.photo_reference_examples (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cls TEXT NOT NULL CHECK (cls IN ('clay_tile','concrete_tile','asphalt_shingle','metal_panel','ridge_cap','roof_vent','flashing','penetration','gutter','valley','siding','exposed_underlayment','shadow','debris','repair','color_variation')),
  embedding JSONB NOT NULL,
  embedding_model_id TEXT NOT NULL DEFAULT 'dinov2-small',
  library_version INTEGER NOT NULL DEFAULT 1,
  source_photo_id TEXT NOT NULL,
  source_region_id TEXT NOT NULL,
  source_finding_id UUID,
  labeled_by UUID NOT NULL,
  approved_by UUID NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT photo_reference_examples_independent_approval CHECK (labeled_by <> approved_by)
);
GRANT SELECT ON public.photo_reference_examples TO authenticated;
GRANT ALL ON public.photo_reference_examples TO service_role;
ALTER TABLE public.photo_reference_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read the reference library" ON public.photo_reference_examples FOR SELECT TO authenticated USING (true);
CREATE POLICY "Platform admins manage reference examples" ON public.photo_reference_examples FOR ALL TO authenticated USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE INDEX idx_photo_reference_examples_cls ON public.photo_reference_examples (cls);
CREATE INDEX idx_photo_reference_examples_model ON public.photo_reference_examples (embedding_model_id, library_version);
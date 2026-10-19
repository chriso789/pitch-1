CREATE TABLE public.photo_reference_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_photo_id uuid NOT NULL,
  source_property_key text NOT NULL,
  cls text NOT NULL,
  polygon jsonb NOT NULL,
  image_hash text NOT NULL,
  embedding jsonb NOT NULL,
  embedding_model_id text NOT NULL DEFAULT 'dinov2-small',
  labeled_by uuid NOT NULL DEFAULT auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prc_independent CHECK (approved_by IS NULL OR approved_by <> labeled_by),
  CONSTRAINT prc_cls CHECK (cls IN ('clay_tile','concrete_tile','asphalt_shingle','metal_panel','ridge_cap','roof_vent','flashing','penetration','gutter','valley','siding','exposed_underlayment','shadow','debris','repair','color_variation'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_reference_candidates TO authenticated;
GRANT ALL ON public.photo_reference_candidates TO service_role;
ALTER TABLE public.photo_reference_candidates ENABLE ROW LEVEL SECURITY;
CREATE INDEX prc_tenant_idx ON public.photo_reference_candidates(tenant_id, approved_by);
CREATE POLICY prc_select ON public.photo_reference_candidates FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_reference_candidates.tenant_id));
CREATE POLICY prc_insert ON public.photo_reference_candidates FOR INSERT TO authenticated
  WITH CHECK (labeled_by = auth.uid() AND approved_by IS NULL AND EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_reference_candidates.tenant_id));
CREATE POLICY prc_approve ON public.photo_reference_candidates FOR UPDATE TO authenticated
  USING (approved_by IS NULL AND labeled_by <> auth.uid() AND EXISTS (SELECT 1 FROM public.user_company_access u WHERE u.user_id = auth.uid() AND u.tenant_id = photo_reference_candidates.tenant_id))
  WITH CHECK (approved_by = auth.uid());
CREATE POLICY prc_delete ON public.photo_reference_candidates FOR DELETE TO authenticated
  USING (approved_by IS NULL AND labeled_by = auth.uid());
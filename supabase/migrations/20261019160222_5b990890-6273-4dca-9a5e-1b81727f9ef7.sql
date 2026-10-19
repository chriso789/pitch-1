CREATE TABLE public.photo_benchmark_sets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_benchmark_sets TO authenticated;
GRANT ALL ON public.photo_benchmark_sets TO service_role;
ALTER TABLE public.photo_benchmark_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members manage their benchmark sets" ON public.photo_benchmark_sets FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_benchmark_sets.tenant_id AND uca.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_benchmark_sets.tenant_id AND uca.is_active = true));

CREATE TABLE public.photo_benchmark_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  set_id UUID NOT NULL REFERENCES public.photo_benchmark_sets(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  property_key TEXT NOT NULL,
  material TEXT NOT NULL DEFAULT 'unknown',
  scene_kind TEXT NOT NULL CHECK (scene_kind IN ('intact','damaged','shadowed','repair','debris','maintenance')),
  component_labels JSONB NOT NULL DEFAULT '[]',
  labels_reviewed BOOLEAN NOT NULL DEFAULT false,
  labeled_by UUID NOT NULL,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT photo_benchmark_items_independent_review CHECK (reviewed_by IS NULL OR reviewed_by <> labeled_by)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photo_benchmark_items TO authenticated;
GRANT ALL ON public.photo_benchmark_items TO service_role;
ALTER TABLE public.photo_benchmark_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members manage their benchmark items" ON public.photo_benchmark_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_benchmark_items.tenant_id AND uca.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM user_company_access uca WHERE uca.user_id = auth.uid() AND uca.tenant_id = photo_benchmark_items.tenant_id AND uca.is_active = true));
CREATE INDEX idx_photo_benchmark_items_set ON public.photo_benchmark_items (set_id);
CREATE INDEX idx_photo_benchmark_items_property ON public.photo_benchmark_items (tenant_id, property_key);
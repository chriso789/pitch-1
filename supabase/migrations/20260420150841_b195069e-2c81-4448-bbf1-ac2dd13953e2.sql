CREATE OR REPLACE FUNCTION public.user_can_access_tenant(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.get_user_tenant_ids() AS t(tid)
    WHERE t.tid = _tenant_id
  )
$$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('roof-line-overlays', 'roof-line-overlays', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.roof_line_overlays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  measurement_id UUID NOT NULL,
  parent_overlay_id UUID REFERENCES public.roof_line_overlays(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'corrected', 'manual')),
  image_url TEXT,
  storage_path TEXT,
  base_image_url TEXT,
  image_width INTEGER,
  image_height INTEGER,
  meters_per_pixel NUMERIC,
  center_lat NUMERIC,
  center_lng NUMERIC,
  zoom NUMERIC,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  totals_ft JSONB DEFAULT '{}'::jsonb,
  model_version TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roof_line_overlays_measurement
  ON public.roof_line_overlays(measurement_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_roof_line_overlays_tenant
  ON public.roof_line_overlays(tenant_id);
CREATE INDEX IF NOT EXISTS idx_roof_line_overlays_source
  ON public.roof_line_overlays(source) WHERE source = 'corrected';

ALTER TABLE public.roof_line_overlays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members view overlays"
  ON public.roof_line_overlays FOR SELECT
  USING (
    public.user_can_access_tenant(tenant_id)
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "Members insert overlays"
  ON public.roof_line_overlays FOR INSERT
  WITH CHECK (
    public.user_can_access_tenant(tenant_id)
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "Members update overlays"
  ON public.roof_line_overlays FOR UPDATE
  USING (
    public.user_can_access_tenant(tenant_id)
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "Service role full access overlays"
  ON public.roof_line_overlays FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER update_roof_line_overlays_updated_at
  BEFORE UPDATE ON public.roof_line_overlays
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Members read overlay images"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'roof-line-overlays'
    AND (
      public.user_can_access_tenant(((storage.foldername(name))[1])::uuid)
      OR public.has_role(auth.uid(), 'master'::app_role)
    )
  );

CREATE POLICY "Members upload overlay images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'roof-line-overlays'
    AND (
      public.user_can_access_tenant(((storage.foldername(name))[1])::uuid)
      OR public.has_role(auth.uid(), 'master'::app_role)
    )
  );

CREATE POLICY "Members update overlay images"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'roof-line-overlays'
    AND (
      public.user_can_access_tenant(((storage.foldername(name))[1])::uuid)
      OR public.has_role(auth.uid(), 'master'::app_role)
    )
  );
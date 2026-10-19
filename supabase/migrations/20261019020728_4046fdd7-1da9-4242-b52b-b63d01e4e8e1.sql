-- =============================================================
-- Canvass photos: storage access rules + photo records table
-- =============================================================

-- ---------- Storage RLS for the private canvass-photos bucket ----------
-- Tenant-safe path convention: first folder segment must be the tenant_id.

CREATE OR REPLACE FUNCTION public.canvass_photo_tenant_allowed(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (p.tenant_id = _tenant_id OR p.active_tenant_id = _tenant_id)
  ) OR EXISTS (
    SELECT 1 FROM public.user_company_access uca
    WHERE uca.user_id = auth.uid()
      AND uca.tenant_id = _tenant_id
      AND uca.is_active = true
  );
$$;

CREATE POLICY "Tenant members can view canvass photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'canvass-photos'
  AND public.canvass_photo_tenant_allowed(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Tenant members can upload canvass photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'canvass-photos'
  AND public.canvass_photo_tenant_allowed(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Tenant members can update canvass photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'canvass-photos'
  AND public.canvass_photo_tenant_allowed(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'canvass-photos'
  AND public.canvass_photo_tenant_allowed(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Tenant members can delete canvass photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'canvass-photos'
  AND public.canvass_photo_tenant_allowed(((storage.foldername(name))[1])::uuid)
);

-- ---------- Photo records table ----------
CREATE TABLE public.canvass_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid REFERENCES public.canvassiq_properties(id) ON DELETE SET NULL,
  property_address text,
  category text NOT NULL DEFAULT 'other',
  notes text,
  storage_path text NOT NULL,
  file_size integer,
  mime_type text,
  latitude double precision,
  longitude double precision,
  uploaded_by uuid,
  taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.canvass_photos TO authenticated;
GRANT ALL ON public.canvass_photos TO service_role;

ALTER TABLE public.canvass_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view canvass photo records"
ON public.canvass_photos FOR SELECT TO authenticated
USING (public.canvass_photo_tenant_allowed(tenant_id));

CREATE POLICY "Tenant members can insert canvass photo records"
ON public.canvass_photos FOR INSERT TO authenticated
WITH CHECK (public.canvass_photo_tenant_allowed(tenant_id));

CREATE POLICY "Uploaders can update their own canvass photos"
ON public.canvass_photos FOR UPDATE TO authenticated
USING (uploaded_by = auth.uid())
WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Uploaders can delete their own canvass photos"
ON public.canvass_photos FOR DELETE TO authenticated
USING (uploaded_by = auth.uid());

CREATE INDEX idx_canvass_photos_tenant_property
ON public.canvass_photos (tenant_id, property_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_canvass_photos_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_canvass_photos_updated_at
BEFORE UPDATE ON public.canvass_photos
FOR EACH ROW EXECUTE FUNCTION public.set_canvass_photos_updated_at();
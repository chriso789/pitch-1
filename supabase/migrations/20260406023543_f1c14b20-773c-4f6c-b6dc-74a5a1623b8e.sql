ALTER TABLE public.roof_vendor_reports
  ADD COLUMN IF NOT EXISTS diagram_image_url TEXT,
  ADD COLUMN IF NOT EXISTS diagram_geometry JSONB;
ALTER TABLE public.plan_pages
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS page_subtype text,
  ADD COLUMN IF NOT EXISTS scale_source text;

ALTER TABLE public.plan_documents
  ADD COLUMN IF NOT EXISTS rasterization_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rasterization_error text;
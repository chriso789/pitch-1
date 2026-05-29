
ALTER TABLE public.quote_tracking_links
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quote_tracking_links_document_id
  ON public.quote_tracking_links(document_id) WHERE document_id IS NOT NULL;

ALTER TABLE public.quote_tracking_links
  ALTER COLUMN estimate_id DROP NOT NULL;

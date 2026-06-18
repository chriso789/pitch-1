ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS scan_source text,
  ADD COLUMN IF NOT EXISTS scan_quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_status text NOT NULL DEFAULT 'not_started';

CREATE INDEX IF NOT EXISTS idx_documents_scan_source ON public.documents(scan_source) WHERE scan_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_ocr_status ON public.documents(ocr_status);

NOTIFY pgrst, 'reload schema';
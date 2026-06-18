
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ocr_text text,
  ADD COLUMN IF NOT EXISTS ocr_search tsvector,
  ADD COLUMN IF NOT EXISTS ocr_error text,
  ADD COLUMN IF NOT EXISTS ocr_completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.documents_update_ocr_search()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.ocr_search :=
    setweight(to_tsvector('english', coalesce(NEW.filename, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.document_type, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.ocr_text, '')), 'C');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_ocr_search_trg ON public.documents;
CREATE TRIGGER documents_ocr_search_trg
BEFORE INSERT OR UPDATE OF ocr_text, filename, document_type
ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.documents_update_ocr_search();

CREATE INDEX IF NOT EXISTS documents_ocr_search_idx
  ON public.documents USING gin (ocr_search);

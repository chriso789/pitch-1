-- =========================================================
-- 1. Tenant-safe OCR search RPC
-- =========================================================
CREATE OR REPLACE FUNCTION public.search_documents_ocr(
  _tenant uuid,
  _q text,
  _limit int DEFAULT 25,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  filename text,
  document_type text,
  file_path text,
  mime_type text,
  file_size bigint,
  page_count int,
  scan_source text,
  ocr_status text,
  ocr_error text,
  ocr_completed_at timestamptz,
  created_at timestamptz,
  uploaded_by uuid,
  description text,
  metadata jsonb,
  scan_quality jsonb,
  rank real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_master boolean := false;
  _allowed boolean := false;
  _query tsquery;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Master bypass
  BEGIN
    SELECT public.has_role(_uid, 'master'::app_role) INTO _is_master;
  EXCEPTION WHEN OTHERS THEN
    _is_master := false;
  END;

  IF _is_master THEN
    _allowed := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = _uid
        AND (p.tenant_id = _tenant OR p.active_tenant_id = _tenant)
    ) INTO _allowed;
  END IF;

  IF NOT _allowed THEN
    RAISE EXCEPTION 'tenant access denied';
  END IF;

  IF _q IS NULL OR length(btrim(_q)) = 0 THEN
    RETURN QUERY
    SELECT d.id, d.filename, d.document_type, d.file_path, d.mime_type,
           d.file_size::bigint, d.page_count, d.scan_source,
           d.ocr_status, d.ocr_error, d.ocr_completed_at,
           d.created_at, d.uploaded_by, d.description, d.metadata, d.scan_quality,
           0::real AS rank
    FROM public.documents d
    WHERE d.tenant_id = _tenant
    ORDER BY d.created_at DESC
    LIMIT GREATEST(_limit, 1)
    OFFSET GREATEST(_offset, 0);
    RETURN;
  END IF;

  _query := websearch_to_tsquery('english', _q);

  RETURN QUERY
  SELECT d.id, d.filename, d.document_type, d.file_path, d.mime_type,
         d.file_size::bigint, d.page_count, d.scan_source,
         d.ocr_status, d.ocr_error, d.ocr_completed_at,
         d.created_at, d.uploaded_by, d.description, d.metadata, d.scan_quality,
         COALESCE(ts_rank(d.ocr_search, _query), 0)::real AS rank
  FROM public.documents d
  WHERE d.tenant_id = _tenant
    AND (
      d.ocr_search @@ _query
      OR d.filename ILIKE '%' || _q || '%'
      OR COALESCE(d.document_type, '') ILIKE '%' || _q || '%'
    )
  ORDER BY rank DESC, d.created_at DESC
  LIMIT GREATEST(_limit, 1)
  OFFSET GREATEST(_offset, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_documents_ocr(uuid, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_documents_ocr(uuid, text, int, int) TO service_role;

NOTIFY pgrst, 'reload schema';

-- =========================================================
-- 2. pg_cron schedule for stale OCR sweeper
-- =========================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule prior job if it exists (id-by-name)
DO $$
DECLARE
  _jobid bigint;
BEGIN
  SELECT jobid INTO _jobid FROM cron.job WHERE jobname = 'retry-stale-ocr-documents-every-10-min';
  IF _jobid IS NOT NULL THEN
    PERFORM cron.unschedule(_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'retry-stale-ocr-documents-every-10-min',
  '*/10 * * * *',
  $cron$
  SELECT net.http_post(
    url:='https://alxelfrbjzkmtnsulcei.supabase.co/functions/v1/retry-stale-ocr-documents',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFseGVsZnJianprbXRuc3VsY2VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgxNTYyNzcsImV4cCI6MjA3MzczMjI3N30.ouuzXBD8iercLbbxtueioRppHsywgpgxEdDqt6AaMtM"}'::jsonb,
    body:=jsonb_build_object('stale_minutes', 10, 'max_retry', 3, 'batch', 25, 'triggered_by','pg_cron')
  ) AS request_id;
  $cron$
);
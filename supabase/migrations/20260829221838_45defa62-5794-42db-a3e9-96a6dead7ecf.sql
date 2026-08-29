CREATE OR REPLACE FUNCTION public.find_storage_object_by_filename(p_filename text, p_limit int DEFAULT 5)
RETURNS TABLE(bucket_id text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT o.bucket_id, o.name
  FROM storage.objects o
  WHERE o.name LIKE '%/' || p_filename OR o.name = p_filename
  ORDER BY o.created_at DESC
  LIMIT GREATEST(COALESCE(p_limit, 5), 1)
$$;

REVOKE ALL ON FUNCTION public.find_storage_object_by_filename(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_storage_object_by_filename(text, int) TO service_role;
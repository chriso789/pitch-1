-- Read-only audit helpers. Master-only. SECURITY DEFINER so they can read pg_catalog.

CREATE OR REPLACE FUNCTION public.audit_list_public_tables()
RETURNS TABLE (
  table_name text,
  rls_enabled boolean,
  policy_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    c.relname::text,
    c.relrowsecurity,
    (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname
$$;

CREATE OR REPLACE FUNCTION public.audit_list_policies()
RETURNS TABLE (
  table_name text,
  policy_name text,
  cmd text,
  permissive text,
  roles text[],
  qual text,
  with_check text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT tablename::text, policyname::text, cmd::text, permissive::text, roles,
         coalesce(qual,'')::text, coalesce(with_check,'')::text
  FROM pg_policies
  WHERE schemaname='public'
  ORDER BY tablename, policyname
$$;

CREATE OR REPLACE FUNCTION public.audit_list_columns_by_name(_column_names text[])
RETURNS TABLE (
  table_name text,
  column_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT table_name::text, column_name::text
  FROM information_schema.columns
  WHERE table_schema='public' AND column_name = ANY(_column_names)
  ORDER BY table_name, column_name
$$;

CREATE OR REPLACE FUNCTION public.audit_pg_stat_user_indexes()
RETURNS TABLE (
  table_name text,
  index_name text,
  idx_scan bigint,
  size_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT s.relname::text, s.indexrelname::text, s.idx_scan,
         pg_relation_size(s.indexrelid)
  FROM pg_stat_user_indexes s
  WHERE s.schemaname='public'
$$;

CREATE OR REPLACE FUNCTION public.audit_pg_stat_user_tables()
RETURNS TABLE (
  table_name text,
  seq_scan bigint,
  idx_scan bigint,
  n_live_tup bigint,
  n_dead_tup bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT relname::text, seq_scan, coalesce(idx_scan,0), n_live_tup, n_dead_tup
  FROM pg_stat_user_tables
  WHERE schemaname='public'
$$;

CREATE OR REPLACE FUNCTION public.audit_pg_stat_statements(_limit integer DEFAULT 25)
RETURNS TABLE (
  mean_ms numeric,
  calls bigint,
  total_s numeric,
  rows_per_call numeric,
  query_excerpt text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Only works if pg_stat_statements extension is installed
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements') THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE format($q$
    SELECT round(mean_exec_time::numeric, 1),
           calls,
           round((total_exec_time/1000)::numeric, 1),
           round(rows::numeric / NULLIF(calls,0), 1),
           left(regexp_replace(query, '\s+', ' ', 'g'), 240)
    FROM pg_stat_statements
    WHERE query NOT ILIKE %L
    ORDER BY total_exec_time DESC
    LIMIT %s
  $q$, '%pg_stat_statements%', _limit);
END
$$;

CREATE OR REPLACE FUNCTION public.audit_storage_buckets_public()
RETURNS TABLE (
  bucket_id text,
  bucket_name text,
  is_public boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT id::text, name::text, public
  FROM storage.buckets
$$;

CREATE OR REPLACE FUNCTION public.audit_orphan_storage_first_segment(_limit integer DEFAULT 50)
RETURNS TABLE (
  bucket_id text,
  object_name text,
  first_segment text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage, pg_catalog
AS $$
  SELECT o.bucket_id::text, o.name::text, split_part(o.name, '/', 1)::text
  FROM storage.objects o
  WHERE split_part(o.name, '/', 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  LIMIT _limit
$$;

-- Lock down: only master role can invoke. Revoke from public/anon/authenticated first.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.audit_list_public_tables()',
    'public.audit_list_policies()',
    'public.audit_list_columns_by_name(text[])',
    'public.audit_pg_stat_user_indexes()',
    'public.audit_pg_stat_user_tables()',
    'public.audit_pg_stat_statements(integer)',
    'public.audit_storage_buckets_public()',
    'public.audit_orphan_storage_first_segment(integer)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

COMMENT ON FUNCTION public.audit_list_public_tables() IS
  'Backend Maintenance Center helper. Service-role only; called from edge functions after master-role check.';
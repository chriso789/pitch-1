
CREATE TABLE IF NOT EXISTS public.edge_function_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name TEXT NOT NULL,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  user_id UUID,
  tenant_id UUID,
  status INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  request_id UUID,
  shim_from TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edge_function_audit_fn_created
  ON public.edge_function_audit (function_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_function_audit_shim_created
  ON public.edge_function_audit (shim_from, created_at DESC)
  WHERE shim_from IS NOT NULL;

ALTER TABLE public.edge_function_audit ENABLE ROW LEVEL SECURITY;

-- Master/COB read access. has_role() already exists in this project.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_role'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY "edge_function_audit_master_read"
      ON public.edge_function_audit
      FOR SELECT
      TO authenticated
      USING (public.has_role(auth.uid(), 'master'::app_role))
    $POL$;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

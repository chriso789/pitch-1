-- Fix abc_connections uniqueness: a tenant can have both a sandbox and a production connection
ALTER TABLE public.abc_connections DROP CONSTRAINT IF EXISTS abc_connections_tenant_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS abc_connections_tenant_env_unique
  ON public.abc_connections (tenant_id, environment);
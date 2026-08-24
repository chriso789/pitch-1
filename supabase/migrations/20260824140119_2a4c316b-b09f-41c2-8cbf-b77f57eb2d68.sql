ALTER TABLE public.login_attempts
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS company_name text;

CREATE INDEX IF NOT EXISTS idx_login_attempts_tenant_created
  ON public.login_attempts (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_attempts_created
  ON public.login_attempts (created_at DESC);
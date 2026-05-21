
CREATE TABLE IF NOT EXISTS public.abc_oauth_callback_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  environment text NULL,
  state text NULL,
  has_code boolean NOT NULL DEFAULT false,
  has_error boolean NOT NULL DEFAULT false,
  error text NULL,
  error_description text NULL,
  full_query jsonb NULL,
  user_agent text NULL,
  ip_address text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS abc_oauth_callback_logs_tenant_created_idx
  ON public.abc_oauth_callback_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS abc_oauth_callback_logs_state_idx
  ON public.abc_oauth_callback_logs (state);

ALTER TABLE public.abc_oauth_callback_logs ENABLE ROW LEVEL SECURITY;

-- Master (COB) read-all
CREATE POLICY "Master can read abc_oauth_callback_logs"
  ON public.abc_oauth_callback_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role));

-- Tenant members can read their own tenant rows
CREATE POLICY "Tenant can read own abc_oauth_callback_logs"
  ON public.abc_oauth_callback_logs
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND tenant_id IN (
      SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
      UNION
      SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()
    )
  );

-- No client INSERT/UPDATE/DELETE policies — edge function uses service role.

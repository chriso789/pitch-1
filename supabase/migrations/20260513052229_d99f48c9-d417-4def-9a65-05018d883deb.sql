
CREATE TABLE IF NOT EXISTS public.qxo_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  username TEXT,
  password TEXT,
  site_id TEXT DEFAULT 'dealersChoice',
  client_id TEXT,
  account_id TEXT,
  profile_id TEXT,
  default_branch_code TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  connection_status TEXT NOT NULL DEFAULT 'disconnected',
  last_validated_at TIMESTAMPTZ,
  last_error TEXT,
  environment TEXT NOT NULL DEFAULT 'staging',
  valid_indicator BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

ALTER TABLE public.qxo_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members manage their qxo connection"
  ON public.qxo_connections
  FOR ALL
  USING (
    tenant_id = public.get_user_tenant_id()
    OR public.has_role(auth.uid(), 'master'::app_role)
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE TRIGGER qxo_connections_updated_at
  BEFORE UPDATE ON public.qxo_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

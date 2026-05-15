
CREATE TABLE IF NOT EXISTS public.abc_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE,
  account_number TEXT,
  client_id TEXT,
  client_secret_encrypted TEXT,
  client_secret_last_four TEXT,
  client_secret_rotated_at TIMESTAMPTZ,
  environment TEXT NOT NULL DEFAULT 'staging' CHECK (environment IN ('staging','production')),
  default_branch_code TEXT,
  connection_status TEXT NOT NULL DEFAULT 'disconnected' CHECK (connection_status IN ('disconnected','connected','error','pending')),
  last_validated_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.abc_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "abc_conn_tenant_select"
  ON public.abc_connections FOR SELECT
  USING (tenant_id = public.get_user_active_tenant_id() OR public.can_view_all_tenants());

CREATE POLICY "abc_conn_tenant_modify"
  ON public.abc_connections FOR ALL
  USING (tenant_id = public.get_user_active_tenant_id() OR public.can_view_all_tenants())
  WITH CHECK (tenant_id = public.get_user_active_tenant_id() OR public.can_view_all_tenants());

CREATE TRIGGER trg_abc_connections_updated
  BEFORE UPDATE ON public.abc_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

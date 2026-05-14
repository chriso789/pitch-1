
CREATE TABLE IF NOT EXISTS public.abc_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  access_token TEXT,
  refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,
  expires_at TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  account_id TEXT,
  account_name TEXT,
  connection_status TEXT NOT NULL DEFAULT 'disconnected',
  last_validated_at TIMESTAMPTZ,
  last_error TEXT,
  last_refreshed_at TIMESTAMPTZ,
  oauth_state TEXT,
  oauth_state_expires_at TIMESTAMPTZ,
  webhook_secret TEXT,
  connected_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.abc_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abc_connections_tenant_read" ON public.abc_connections FOR SELECT
  USING (tenant_id = public.get_user_active_tenant_id() OR public.has_role(auth.uid(), 'master'::app_role));
CREATE POLICY "abc_connections_no_client_write" ON public.abc_connections FOR ALL USING (false) WITH CHECK (false);
CREATE TRIGGER abc_connections_updated_at BEFORE UPDATE ON public.abc_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.abc_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_type TEXT,
  event_id TEXT,
  resource_id TEXT,
  payload JSONB NOT NULL,
  headers JSONB,
  signature TEXT,
  signature_valid BOOLEAN,
  event_status TEXT NOT NULL DEFAULT 'received',
  processing_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS abc_webhook_events_tenant_idx ON public.abc_webhook_events(tenant_id, received_at DESC);
ALTER TABLE public.abc_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abc_webhook_events_tenant_read" ON public.abc_webhook_events FOR SELECT
  USING (tenant_id = public.get_user_active_tenant_id() OR public.has_role(auth.uid(), 'master'::app_role));
CREATE POLICY "abc_webhook_events_no_client_write" ON public.abc_webhook_events FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.abc_credential_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  action TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  error TEXT,
  actor_id UUID,
  actor_email TEXT,
  ip_address TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abc_credential_audit_tenant_idx ON public.abc_credential_audit(tenant_id, created_at DESC);
ALTER TABLE public.abc_credential_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "abc_credential_audit_tenant_read" ON public.abc_credential_audit FOR SELECT
  USING (tenant_id = public.get_user_active_tenant_id() OR public.has_role(auth.uid(), 'master'::app_role));
CREATE POLICY "abc_credential_audit_no_client_write" ON public.abc_credential_audit FOR ALL USING (false) WITH CHECK (false);

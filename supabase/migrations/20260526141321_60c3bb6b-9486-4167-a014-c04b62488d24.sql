
ALTER TABLE public.qbo_connections
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS disconnected_at timestamptz,
  ADD COLUMN IF NOT EXISTS connected_by uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS oauth_state text;

-- Backfill token_expires_at from legacy expires_at where missing
UPDATE public.qbo_connections
  SET token_expires_at = expires_at
  WHERE token_expires_at IS NULL AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qbo_connections_tenant_active
  ON public.qbo_connections (tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_qbo_connections_realm
  ON public.qbo_connections (realm_id);

NOTIFY pgrst, 'reload schema';

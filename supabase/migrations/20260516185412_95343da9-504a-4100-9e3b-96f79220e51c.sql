-- Move QXO secrets out of client-readable qxo_connections into service-role-only qxo_credentials.

-- 1) Create credentials table (no RLS policies => clients cannot read/write)
CREATE TABLE IF NOT EXISTS public.qxo_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE,
  username TEXT,
  password TEXT,
  client_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.qxo_credentials ENABLE ROW LEVEL SECURITY;
-- Intentionally NO POLICIES: only the service role bypasses RLS and may access this table.

CREATE TRIGGER qxo_credentials_updated_at
  BEFORE UPDATE ON public.qxo_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Add presence flag on qxo_connections so UI can show "credentials on file" without exposing secrets
ALTER TABLE public.qxo_connections
  ADD COLUMN IF NOT EXISTS has_credentials BOOLEAN NOT NULL DEFAULT false;

-- 3) Backfill credentials from existing rows
INSERT INTO public.qxo_credentials
  (tenant_id, username, password, client_id, access_token, refresh_token, token_expires_at)
SELECT
  tenant_id, username, password, client_id, access_token, refresh_token, token_expires_at
FROM public.qxo_connections
WHERE username IS NOT NULL
   OR password IS NOT NULL
   OR client_id IS NOT NULL
   OR access_token IS NOT NULL
   OR refresh_token IS NOT NULL
ON CONFLICT (tenant_id) DO NOTHING;

UPDATE public.qxo_connections c
  SET has_credentials = true
  WHERE EXISTS (SELECT 1 FROM public.qxo_credentials k WHERE k.tenant_id = c.tenant_id);

-- 4) Drop sensitive columns from qxo_connections (client-readable table)
ALTER TABLE public.qxo_connections
  DROP COLUMN IF EXISTS username,
  DROP COLUMN IF EXISTS password,
  DROP COLUMN IF EXISTS client_id,
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token,
  DROP COLUMN IF EXISTS token_expires_at;
ALTER TABLE public.abc_connections
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS account_number TEXT,
  ADD COLUMN IF NOT EXISTS client_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS client_secret_last_four TEXT,
  ADD COLUMN IF NOT EXISTS client_secret_rotated_at TIMESTAMPTZ;
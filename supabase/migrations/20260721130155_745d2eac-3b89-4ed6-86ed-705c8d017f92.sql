
ALTER TABLE public.qbo_webhook_journal
  ADD COLUMN IF NOT EXISTS qbo_connection_id uuid REFERENCES public.qbo_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS oauth_app_env text,
  ADD COLUMN IF NOT EXISTS signature_environment text,
  ADD COLUMN IF NOT EXISTS entity_id text,
  ADD COLUMN IF NOT EXISTS operation text,
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS intuit_tid text,
  ADD COLUMN IF NOT EXISTS request_correlation_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS qbo_webhook_journal_idem_uidx
  ON public.qbo_webhook_journal(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS qbo_webhook_journal_conn_env_idx
  ON public.qbo_webhook_journal(qbo_connection_id, oauth_app_env, created_at DESC);

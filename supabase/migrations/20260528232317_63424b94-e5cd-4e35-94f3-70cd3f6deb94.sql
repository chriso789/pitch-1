-- 1. abc_webhooks: environment + last activity
ALTER TABLE public.abc_webhooks
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS last_event_received_at timestamptz;

-- 2. abc_webhook_events: provider tracking, payload hash, link to order, quarantine, signature_valid alias
ALTER TABLE public.abc_webhook_events
  ADD COLUMN IF NOT EXISTS provider text DEFAULT 'abc',
  ADD COLUMN IF NOT EXISTS provider_event_id text,
  ADD COLUMN IF NOT EXISTS purchase_order text,
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS signature_valid boolean,
  ADD COLUMN IF NOT EXISTS abc_order_id uuid,
  ADD COLUMN IF NOT EXISTS quarantine_reason text;

-- 3. Idempotency: dedupe by (webhook_id, event_type, payload_hash)
CREATE UNIQUE INDEX IF NOT EXISTS abc_webhook_events_dedupe_idx
  ON public.abc_webhook_events (webhook_id, event_type, payload_hash)
  WHERE payload_hash IS NOT NULL;

-- 4. Idempotency: dedupe by (provider, provider_event_id) when ABC supplies an event id
CREATE UNIQUE INDEX IF NOT EXISTS abc_webhook_events_provider_event_idx
  ON public.abc_webhook_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- 5. FK from abc_webhook_events.abc_order_id -> abc_orders.id (set null on order delete)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'abc_webhook_events_abc_order_id_fkey'
  ) THEN
    ALTER TABLE public.abc_webhook_events
      ADD CONSTRAINT abc_webhook_events_abc_order_id_fkey
      FOREIGN KEY (abc_order_id) REFERENCES public.abc_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 6. Service-role grant (already RLS-locked; webhook receiver uses service role)
GRANT SELECT, INSERT, UPDATE ON public.abc_webhook_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.abc_webhooks TO service_role;
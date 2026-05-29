-- =========================================================
-- Square integration foundation
-- =========================================================

-- 1) tenant_square_accounts: per-tenant Square OAuth connection
CREATE TABLE IF NOT EXISTS public.tenant_square_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production')),
  -- OAuth tokens (Square access tokens; never exposed to the browser; RLS denies read to authenticated)
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,
  merchant_id text,
  merchant_name text,
  selected_location_id text,
  selected_location_name text,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','needs_reauth','disconnected')),
  connected_by uuid,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_webhook_at timestamptz,
  last_payment_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_square_accounts_tenant ON public.tenant_square_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_square_accounts_merchant ON public.tenant_square_accounts(merchant_id);

-- Service role only — tokens never reach the browser.
-- Authenticated users read connection status via an edge function that returns a redacted view.
GRANT ALL ON public.tenant_square_accounts TO service_role;

ALTER TABLE public.tenant_square_accounts ENABLE ROW LEVEL SECURITY;

-- No authenticated SELECT policy: prevents accidental client exposure of tokens.
-- Service-role bypass + edge function returns a safe DTO.
CREATE POLICY "service_role_all_tenant_square_accounts"
  ON public.tenant_square_accounts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tsa_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tsa_updated_at ON public.tenant_square_accounts;
CREATE TRIGGER trg_tsa_updated_at
  BEFORE UPDATE ON public.tenant_square_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tsa_set_updated_at();

-- =========================================================
-- 2) square_webhook_events: idempotency log for Square webhooks
-- =========================================================
CREATE TABLE IF NOT EXISTS public.square_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  event_id text NOT NULL UNIQUE,           -- Square event_id; dedupe key
  event_type text NOT NULL,                 -- e.g. payment.updated, oauth.authorization.revoked
  merchant_id text,
  signature_valid boolean NOT NULL DEFAULT false,
  accepted boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL,
  payload_hash text,
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_square_webhook_events_tenant ON public.square_webhook_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_square_webhook_events_type ON public.square_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_square_webhook_events_received ON public.square_webhook_events(received_at DESC);

GRANT ALL ON public.square_webhook_events TO service_role;

ALTER TABLE public.square_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_square_webhook_events"
  ON public.square_webhook_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =========================================================
-- 3) payment_links: add provider-agnostic columns
-- =========================================================
ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_payment_link_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_link_url text,
  ADD COLUMN IF NOT EXISTS provider_order_id text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS provider_location_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_event_id text;

-- Backfill provider from existing columns
UPDATE public.payment_links
SET provider = CASE
  WHEN payment_type = 'zelle' THEN 'zelle'
  WHEN stripe_payment_link_id IS NOT NULL OR stripe_payment_link_url IS NOT NULL THEN 'stripe'
  ELSE COALESCE(payment_type, 'stripe')
END
WHERE provider IS NULL;

-- Mirror legacy stripe_* into provider_* for unified reads
UPDATE public.payment_links
SET provider_payment_link_id = stripe_payment_link_id,
    provider_payment_link_url = stripe_payment_link_url
WHERE provider = 'stripe'
  AND provider_payment_link_id IS NULL
  AND stripe_payment_link_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_links_provider ON public.payment_links(provider);
CREATE INDEX IF NOT EXISTS idx_payment_links_provider_order ON public.payment_links(provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_links_provider_payment ON public.payment_links(provider_payment_id) WHERE provider_payment_id IS NOT NULL;
-- Unique guard: a single provider payment can only map to one payment_links row
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_links_provider_payment
  ON public.payment_links(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- =========================================================
-- 4) project_payments: track provider lineage for idempotent webhook inserts
-- =========================================================
ALTER TABLE public.project_payments
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS provider_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_payments_provider_payment
  ON public.project_payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
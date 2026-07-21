-- Phase 1B: capability-driven invoice link + reconciliation ledger.

-- 1. invoice_ar_mirror capability columns
ALTER TABLE public.invoice_ar_mirror
  ADD COLUMN IF NOT EXISTS invoice_link_status text
    NOT NULL DEFAULT 'unknown'
    CHECK (invoice_link_status IN (
      'available','unavailable','pending','expired','invalid','access_denied','unknown'
    )),
  ADD COLUMN IF NOT EXISTS invoice_link_source text
    NOT NULL DEFAULT 'unavailable'
    CHECK (invoice_link_source IN (
      'qbo_create_response','qbo_read_response','unavailable'
    )),
  ADD COLUMN IF NOT EXISTS invoice_link_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_link_last_error text,
  ADD COLUMN IF NOT EXISTS online_card_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS online_ach_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_capability_message text,
  ADD COLUMN IF NOT EXISTS paid_at_source text
    CHECK (paid_at_source IN ('qbo_payment_txn_date','reconciliation_timestamp'));

-- 2. Append-only reconciliation event ledger
CREATE TABLE IF NOT EXISTS public.invoice_reconciliation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  qbo_connection_id uuid NOT NULL,
  realm_id text,
  invoice_ar_mirror_id uuid REFERENCES public.invoice_ar_mirror(id) ON DELETE SET NULL,
  pitch_invoice_id uuid,
  qbo_invoice_id text,
  qbo_payment_id text,
  event_type text NOT NULL CHECK (event_type IN (
    'invoice_pushed',
    'invoice_read',
    'invoice_link_verified',
    'invoice_link_unavailable',
    'invoice_link_invalid',
    'partial_payment_applied',
    'full_payment_applied',
    'payment_updated',
    'payment_reversed',
    'payment_voided',
    'invoice_reopened',
    'invoice_voided',
    'sync_error',
    'webhook_dedup_skipped'
  )),
  balance_before numeric,
  balance_after numeric,
  total_amount numeric,
  amount_applied numeric,
  authoritative_source text CHECK (authoritative_source IN ('qbo_read','webhook_payload','worker_computed')),
  intuit_tid text,
  webhook_event_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.invoice_reconciliation_events TO authenticated;
GRANT ALL ON public.invoice_reconciliation_events TO service_role;

ALTER TABLE public.invoice_reconciliation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recon_events_tenant_read"
  ON public.invoice_reconciliation_events
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT uca.tenant_id
      FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_recon_events_mirror
  ON public.invoice_reconciliation_events (invoice_ar_mirror_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recon_events_tenant_created
  ON public.invoice_reconciliation_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recon_events_qbo_invoice
  ON public.invoice_reconciliation_events (qbo_connection_id, qbo_invoice_id);
CREATE INDEX IF NOT EXISTS idx_recon_events_qbo_payment
  ON public.invoice_reconciliation_events (qbo_connection_id, qbo_payment_id);

-- 3. Duplicate webhook delivery guard
ALTER TABLE public.qbo_webhook_events
  ADD COLUMN IF NOT EXISTS dedup_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_qbo_webhook_events_dedup
  ON public.qbo_webhook_events (dedup_key)
  WHERE dedup_key IS NOT NULL;

-- 4. Ready-for-accounting-review helper column (advisory only, per Phase 1B item 6)
ALTER TABLE public.invoice_ar_mirror
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz;

NOTIFY pgrst, 'reload schema';

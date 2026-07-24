
-- 1. tenant_email_settings ---------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_email_settings (
  tenant_id UUID PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'resend' CHECK (provider IN ('resend')),
  from_name TEXT,
  from_email TEXT,
  reply_to TEXT,
  sending_enabled BOOLEAN NOT NULL DEFAULT true,
  verified_domain_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verified_domain_status IN ('unverified','pending','verified')),
  invoice_template_version INTEGER NOT NULL DEFAULT 1,
  platform_sender_fallback_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tenant_email_settings TO authenticated;
GRANT ALL ON public.tenant_email_settings TO service_role;

ALTER TABLE public.tenant_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read own tenant email settings"
  ON public.tenant_email_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Admins update own tenant email settings"
  ON public.tenant_email_settings FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'master')
      OR public.has_role(auth.uid(), 'corporate')
      OR public.has_role(auth.uid(), 'office_admin')
    )
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'master')
      OR public.has_role(auth.uid(), 'corporate')
      OR public.has_role(auth.uid(), 'office_admin')
    )
  );

CREATE POLICY "Admins insert own tenant email settings"
  ON public.tenant_email_settings FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'master')
      OR public.has_role(auth.uid(), 'corporate')
      OR public.has_role(auth.uid(), 'office_admin')
    )
  );

-- 2. invoice_email_deliveries ------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_email_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID,
  pitch_invoice_id UUID NOT NULL,
  portal_token_id UUID REFERENCES public.invoice_portal_tokens(id) ON DELETE SET NULL,
  contact_id UUID,
  recipient_email TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT,
  reply_to TEXT,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('tenant_verified','platform_fallback')),
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT,
  send_request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  template_version INTEGER NOT NULL DEFAULT 1,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','accepted','sent','delivered','delayed','bounced','complained','failed')),
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  delayed_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  complained_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  is_resend BOOLEAN NOT NULL DEFAULT false,
  parent_delivery_id UUID REFERENCES public.invoice_email_deliveries(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT invoice_email_deliveries_idem_key UNIQUE (tenant_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_email_deliv_msg_id
  ON public.invoice_email_deliveries (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_email_deliv_invoice
  ON public.invoice_email_deliveries (pitch_invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_email_deliv_tenant
  ON public.invoice_email_deliveries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_email_deliv_recipient
  ON public.invoice_email_deliveries (tenant_id, lower(recipient_email), created_at DESC);

GRANT SELECT ON public.invoice_email_deliveries TO authenticated;
GRANT ALL ON public.invoice_email_deliveries TO service_role;

ALTER TABLE public.invoice_email_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read invoice deliveries in their tenant"
  ON public.invoice_email_deliveries FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- 3. provider_webhook_events (dedupe) ----------------------
CREATE TABLE IF NOT EXISTS public.provider_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT,
  payload_hash TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processing_result TEXT,
  CONSTRAINT provider_webhook_events_unique UNIQUE (provider, provider_event_id)
);

GRANT ALL ON public.provider_webhook_events TO service_role;
ALTER TABLE public.provider_webhook_events ENABLE ROW LEVEL SECURITY;

-- 4. Extend customer_invoice_events event_type CHECK -------
ALTER TABLE public.customer_invoice_events
  DROP CONSTRAINT IF EXISTS customer_invoice_events_event_type_check;

ALTER TABLE public.customer_invoice_events
  ADD CONSTRAINT customer_invoice_events_event_type_check
  CHECK (event_type IN (
    'invoice_portal_link_created',
    'invoice_portal_link_revoked',
    'invoice_email_queued',
    'invoice_email_accepted',
    'invoice_email_sent',
    'invoice_email_delivered',
    'invoice_email_delayed',
    'invoice_email_bounced',
    'invoice_email_complained',
    'invoice_email_failed',
    'invoice_email_resent',
    'invoice_viewed',
    'invoice_downloaded',
    'payment_link_clicked',
    'portal_link_copied',
    'customer_view_previewed',
    'invoice_paid_seen',
    'access_link_expired',
    'access_link_revoked'
  ));

-- 5. updated_at trigger for the two new tables -------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_touch_tenant_email_settings ON public.tenant_email_settings;
CREATE TRIGGER trg_touch_tenant_email_settings
  BEFORE UPDATE ON public.tenant_email_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_invoice_email_deliveries ON public.invoice_email_deliveries;
CREATE TRIGGER trg_touch_invoice_email_deliveries
  BEFORE UPDATE ON public.invoice_email_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

NOTIFY pgrst, 'reload schema';

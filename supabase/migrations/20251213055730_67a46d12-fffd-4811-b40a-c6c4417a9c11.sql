-- =============================================
-- MESSAGING INFRASTRUCTURE TABLES
-- =============================================

-- 1. inbound_messages table - stores all inbound SMS/email messages
CREATE TABLE IF NOT EXISTS public.inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('sms', 'email')),
  from_address TEXT NOT NULL,
  to_address TEXT,
  body TEXT,
  provider_message_id TEXT,
  provider TEXT, -- 'telnyx', 'twilio', 'sendgrid'
  metadata JSONB DEFAULT '{}',
  received_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. opt_outs table - tracks STOP/unsubscribe requests for compliance
CREATE TABLE IF NOT EXISTS public.opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'voice')),
  phone TEXT,
  email TEXT,
  reason TEXT,
  source TEXT CHECK (source IN ('reply_stop', 'bounce', 'complaint', 'user_request', 'manual')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT opt_outs_phone_or_email CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

-- 3. messaging_providers table - provider configuration per tenant
CREATE TABLE IF NOT EXISTS public.messaging_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('telnyx_sms', 'twilio_sms', 'sendgrid_email', 'telnyx_voice')),
  is_active BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, provider_type)
);

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================
CREATE INDEX IF NOT EXISTS idx_inbound_messages_tenant_id ON public.inbound_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_contact_id ON public.inbound_messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_received_at ON public.inbound_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_from_address ON public.inbound_messages(from_address);

CREATE INDEX IF NOT EXISTS idx_opt_outs_tenant_id ON public.opt_outs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opt_outs_phone ON public.opt_outs(phone);
CREATE INDEX IF NOT EXISTS idx_opt_outs_email ON public.opt_outs(email);

CREATE INDEX IF NOT EXISTS idx_messaging_providers_tenant_id ON public.messaging_providers(tenant_id);

-- =============================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================

-- Enable RLS on all tables
ALTER TABLE public.inbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messaging_providers ENABLE ROW LEVEL SECURITY;

-- inbound_messages policies
CREATE POLICY "Users can view their tenant's inbound messages"
  ON public.inbound_messages FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can insert inbound messages for their tenant"
  ON public.inbound_messages FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- opt_outs policies
CREATE POLICY "Users can view their tenant's opt-outs"
  ON public.opt_outs FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can insert opt-outs for their tenant"
  ON public.opt_outs FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can delete opt-outs for their tenant"
  ON public.opt_outs FOR DELETE
  USING (tenant_id = public.get_user_tenant_id());

-- messaging_providers policies
CREATE POLICY "Users can view their tenant's messaging providers"
  ON public.messaging_providers FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can manage their tenant's messaging providers"
  ON public.messaging_providers FOR ALL
  USING (tenant_id = public.get_user_tenant_id());

-- =============================================
-- HELPER FUNCTION: Check opt-out status
-- =============================================
CREATE OR REPLACE FUNCTION public.check_opt_out(
  p_tenant_id UUID,
  p_channel TEXT,
  p_phone TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.opt_outs
    WHERE tenant_id = p_tenant_id
      AND channel = p_channel
      AND (
        (p_phone IS NOT NULL AND phone = p_phone)
        OR (p_email IS NOT NULL AND email = p_email)
      )
  );
END;
$$;

-- =============================================
-- SEED O'BRIEN CONTRACTING PROVIDER CONFIG
-- =============================================
INSERT INTO public.messaging_providers (tenant_id, provider_type, is_active, config)
VALUES (
  '14de934e-7964-4afd-940a-620d2ace125d',
  'telnyx_sms',
  true,
  '{
    "profile_id": "40019b10-e9de-48f9-9947-827fbc6b76df",
    "from_number": "+12399194485",
    "webhook_configured": true
  }'::jsonb
)
ON CONFLICT (tenant_id, provider_type) DO UPDATE
SET config = EXCLUDED.config, updated_at = NOW();
-- Email engagement events table for tracking opens, clicks, bounces
CREATE TABLE IF NOT EXISTS public.email_engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  resend_message_id TEXT,
  email_type TEXT NOT NULL DEFAULT 'onboarding',
  event_type TEXT NOT NULL CHECK (event_type IN ('delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed')),
  email_address TEXT,
  link_url TEXT,
  user_agent TEXT,
  ip_address TEXT,
  timestamp TIMESTAMPTZ DEFAULT now(),
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_email_engagement_resend_id ON public.email_engagement_events(resend_message_id);
CREATE INDEX IF NOT EXISTS idx_email_engagement_type ON public.email_engagement_events(event_type);
CREATE INDEX IF NOT EXISTS idx_email_engagement_email ON public.email_engagement_events(email_address);

-- RLS policies
ALTER TABLE public.email_engagement_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's email events" ON public.email_engagement_events
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Service role can insert email events" ON public.email_engagement_events
  FOR INSERT WITH CHECK (true);

-- Add tracking columns to onboarding_email_log if not exists
ALTER TABLE public.onboarding_email_log 
ADD COLUMN IF NOT EXISTS opens_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS clicks_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_opened_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ;
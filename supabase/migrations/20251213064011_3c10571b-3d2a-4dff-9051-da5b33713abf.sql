-- ========================================
-- EMAIL DOMAIN CONFIGURATION
-- ========================================

CREATE TABLE public.company_email_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  reply_to_email TEXT,
  verification_token TEXT,
  verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'failed')),
  verified_at TIMESTAMPTZ,
  resend_domain_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, domain)
);

ALTER TABLE public.company_email_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their company email domains"
  ON public.company_email_domains FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Admins can manage company email domains"
  ON public.company_email_domains FOR ALL
  USING (tenant_id = public.get_user_tenant_id());

-- ========================================
-- QUOTE TRACKING LINKS
-- ========================================

CREATE TABLE public.quote_tracking_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  estimate_id UUID REFERENCES public.estimates(id) ON DELETE CASCADE,
  proposal_id UUID,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  pipeline_entry_id UUID REFERENCES public.pipeline_entries(id) ON DELETE SET NULL,
  pdf_url TEXT,
  recipient_email TEXT,
  recipient_name TEXT,
  sent_by UUID REFERENCES auth.users(id),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  view_count INTEGER DEFAULT 0,
  last_viewed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.quote_tracking_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their quote links"
  ON public.quote_tracking_links FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can create quote links"
  ON public.quote_tracking_links FOR INSERT
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Users can update quote links"
  ON public.quote_tracking_links FOR UPDATE
  USING (tenant_id = public.get_user_tenant_id());

CREATE INDEX idx_quote_tracking_links_token ON public.quote_tracking_links(token);
CREATE INDEX idx_quote_tracking_links_token_hash ON public.quote_tracking_links(token_hash);
CREATE INDEX idx_quote_tracking_links_estimate ON public.quote_tracking_links(estimate_id);

-- ========================================
-- QUOTE VIEW EVENTS (ANALYTICS)
-- ========================================

CREATE TABLE public.quote_view_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tracking_link_id UUID NOT NULL REFERENCES public.quote_tracking_links(id) ON DELETE CASCADE,
  viewer_ip TEXT,
  viewer_user_agent TEXT,
  viewer_device TEXT,
  viewer_browser TEXT,
  viewer_os TEXT,
  viewer_city TEXT,
  viewer_region TEXT,
  viewer_country TEXT,
  session_id TEXT,
  duration_seconds INTEGER DEFAULT 0,
  pages_viewed INTEGER DEFAULT 1,
  scroll_depth_percent INTEGER,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

ALTER TABLE public.quote_view_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their quote view events"
  ON public.quote_view_events FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());

CREATE INDEX idx_quote_view_events_link ON public.quote_view_events(tracking_link_id);
CREATE INDEX idx_quote_view_events_viewed_at ON public.quote_view_events(viewed_at DESC);

-- ========================================
-- UPDATE TRIGGERS
-- ========================================

CREATE TRIGGER update_company_email_domains_updated_at
  BEFORE UPDATE ON public.company_email_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
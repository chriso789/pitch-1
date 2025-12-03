
-- ============================================================================
-- Marketing & Product Tracking System - Phase 1 Database Schema
-- Unified tracking for pitch-crm.ai marketing site and CRM product app
-- ============================================================================

-- 1. MARKETING SESSIONS (Anonymous visitors before signup)
CREATE TABLE public.marketing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL, -- Linked after signup
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL, -- Linked after login
  session_key TEXT UNIQUE NOT NULL,
  channel TEXT NOT NULL DEFAULT 'MARKETING_SITE' CHECK (channel IN ('MARKETING_SITE', 'PRODUCT_APP')),
  site_domain TEXT DEFAULT 'pitch-crm.ai',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  ip_country CHAR(2),
  user_agent TEXT,
  device_type TEXT CHECK (device_type IN ('desktop', 'mobile', 'tablet')),
  device_hash TEXT,
  referrer TEXT,
  landing_page TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  analytics_consent BOOLEAN DEFAULT false,
  marketing_consent BOOLEAN DEFAULT false,
  page_views INTEGER DEFAULT 0,
  events_count INTEGER DEFAULT 0,
  converted BOOLEAN DEFAULT false,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TRACKING EVENTS (Unified for marketing and product)
CREATE TABLE public.tracking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.marketing_sessions(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('MARKETING_SITE', 'PRODUCT_APP')),
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ DEFAULT NOW(),
  path TEXT,
  referrer TEXT,
  element_id TEXT,
  element_text TEXT,
  metadata JSONB DEFAULT '{}',
  scroll_depth INTEGER CHECK (scroll_depth >= 0 AND scroll_depth <= 100),
  time_on_page INTEGER,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. VISITOR CONSENTS (GDPR/CCPA compliance)
CREATE TABLE public.visitor_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.marketing_sessions(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('essential', 'analytics', 'marketing', 'personalization')),
  granted BOOLEAN NOT NULL,
  version TEXT DEFAULT '1.0',
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  source TEXT DEFAULT 'web' CHECK (source IN ('web', 'app', 'api')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ADMIN ACCESS LOGS (Security audit trail)
CREATE TABLE public.admin_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  admin_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL NOT NULL,
  action TEXT NOT NULL,
  target_resource TEXT,
  target_id UUID,
  target_tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  route TEXT,
  method TEXT CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  status_code INTEGER,
  ip_address INET,
  user_agent TEXT,
  request_metadata JSONB DEFAULT '{}',
  response_summary TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. SECURITY ALERTS (Threat detection)
CREATE TABLE public.security_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.marketing_sessions(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('MARKETING_SITE', 'PRODUCT_APP', 'API', 'SYSTEM')),
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'LOW' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  summary TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES for Performance
-- ============================================================================

-- Marketing Sessions indexes
CREATE INDEX idx_marketing_sessions_session_key ON public.marketing_sessions(session_key);
CREATE INDEX idx_marketing_sessions_tenant_id ON public.marketing_sessions(tenant_id);
CREATE INDEX idx_marketing_sessions_channel ON public.marketing_sessions(channel);
CREATE INDEX idx_marketing_sessions_created_at ON public.marketing_sessions(created_at DESC);
CREATE INDEX idx_marketing_sessions_utm_source ON public.marketing_sessions(utm_source) WHERE utm_source IS NOT NULL;
CREATE INDEX idx_marketing_sessions_utm_campaign ON public.marketing_sessions(utm_campaign) WHERE utm_campaign IS NOT NULL;
CREATE INDEX idx_marketing_sessions_converted ON public.marketing_sessions(converted) WHERE converted = true;
CREATE INDEX idx_marketing_sessions_user_id ON public.marketing_sessions(user_id) WHERE user_id IS NOT NULL;

-- Tracking Events indexes
CREATE INDEX idx_tracking_events_session_id ON public.tracking_events(session_id);
CREATE INDEX idx_tracking_events_tenant_id ON public.tracking_events(tenant_id);
CREATE INDEX idx_tracking_events_channel ON public.tracking_events(channel);
CREATE INDEX idx_tracking_events_event_type ON public.tracking_events(event_type);
CREATE INDEX idx_tracking_events_occurred_at ON public.tracking_events(occurred_at DESC);
CREATE INDEX idx_tracking_events_user_id ON public.tracking_events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_tracking_events_path ON public.tracking_events(path);

-- Visitor Consents indexes
CREATE INDEX idx_visitor_consents_session_id ON public.visitor_consents(session_id);
CREATE INDEX idx_visitor_consents_consent_type ON public.visitor_consents(consent_type);
CREATE INDEX idx_visitor_consents_granted ON public.visitor_consents(granted);

-- Admin Access Logs indexes
CREATE INDEX idx_admin_access_logs_tenant_id ON public.admin_access_logs(tenant_id);
CREATE INDEX idx_admin_access_logs_admin_user_id ON public.admin_access_logs(admin_user_id);
CREATE INDEX idx_admin_access_logs_action ON public.admin_access_logs(action);
CREATE INDEX idx_admin_access_logs_created_at ON public.admin_access_logs(created_at DESC);

-- Security Alerts indexes
CREATE INDEX idx_security_alerts_tenant_id ON public.security_alerts(tenant_id);
CREATE INDEX idx_security_alerts_severity ON public.security_alerts(severity);
CREATE INDEX idx_security_alerts_alert_type ON public.security_alerts(alert_type);
CREATE INDEX idx_security_alerts_resolved ON public.security_alerts(resolved) WHERE resolved = false;
CREATE INDEX idx_security_alerts_detected_at ON public.security_alerts(detected_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Marketing Sessions RLS
ALTER TABLE public.marketing_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can insert marketing sessions"
  ON public.marketing_sessions FOR INSERT
  WITH CHECK (channel = 'MARKETING_SITE');

CREATE POLICY "Service role can manage all sessions"
  ON public.marketing_sessions FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view sessions in their tenant"
  ON public.marketing_sessions FOR SELECT
  USING (
    tenant_id IS NULL 
    OR tenant_id = get_user_tenant_id()
    OR EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() 
      AND p.role IN ('master', 'corporate', 'office_admin')
    )
  );

-- Tracking Events RLS
ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can insert tracking events"
  ON public.tracking_events FOR INSERT
  WITH CHECK (channel = 'MARKETING_SITE');

CREATE POLICY "Service role can manage all events"
  ON public.tracking_events FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view events in their tenant"
  ON public.tracking_events FOR SELECT
  USING (
    tenant_id IS NULL 
    OR tenant_id = get_user_tenant_id()
    OR EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() 
      AND p.role IN ('master', 'corporate', 'office_admin')
    )
  );

-- Visitor Consents RLS
ALTER TABLE public.visitor_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can insert consents"
  ON public.visitor_consents FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can manage all consents"
  ON public.visitor_consents FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users can view their own consents"
  ON public.visitor_consents FOR SELECT
  USING (user_id = auth.uid() OR session_id IN (
    SELECT id FROM marketing_sessions WHERE user_id = auth.uid()
  ));

-- Admin Access Logs RLS
ALTER TABLE public.admin_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert access logs"
  ON public.admin_access_logs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Master admins can view all access logs"
  ON public.admin_access_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() 
      AND p.role = 'master'
    )
  );

CREATE POLICY "Admins can view their tenant access logs"
  ON public.admin_access_logs FOR SELECT
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() 
      AND p.role IN ('corporate', 'office_admin')
    )
  );

-- Security Alerts RLS
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage all alerts"
  ON public.security_alerts FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view and update alerts in their tenant"
  ON public.security_alerts FOR ALL
  USING (
    tenant_id IS NULL 
    OR tenant_id = get_user_tenant_id()
    OR EXISTS (
      SELECT 1 FROM profiles p 
      WHERE p.id = auth.uid() 
      AND p.role IN ('master', 'corporate', 'office_admin')
    )
  );

-- ============================================================================
-- TRIGGERS for updated_at
-- ============================================================================

CREATE TRIGGER update_marketing_sessions_updated_at
  BEFORE UPDATE ON public.marketing_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_security_alerts_updated_at
  BEFORE UPDATE ON public.security_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

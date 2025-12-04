-- Platform-wide announcements from master admin
CREATE TABLE platform_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  html_content TEXT,
  announcement_type TEXT DEFAULT 'general' CHECK (announcement_type IN ('general', 'feature', 'maintenance', 'urgent')),
  target_companies UUID[] DEFAULT '{}',
  sent_by UUID REFERENCES profiles(id),
  sent_at TIMESTAMPTZ,
  scheduled_for TIMESTAMPTZ,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent', 'cancelled')),
  read_by JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track onboarding emails sent
CREATE TABLE onboarding_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  sent_by UUID REFERENCES profiles(id),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed')),
  resend_message_id TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Company internal announcements
CREATE TABLE company_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  html_content TEXT,
  target_roles TEXT[] DEFAULT '{}',
  target_locations UUID[] DEFAULT '{}',
  sent_by UUID REFERENCES profiles(id),
  sent_at TIMESTAMPTZ,
  scheduled_for TIMESTAMPTZ,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track announcement reads
CREATE TABLE company_announcement_reads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID REFERENCES company_announcements(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, user_id)
);

-- RLS Policies
ALTER TABLE platform_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_announcement_reads ENABLE ROW LEVEL SECURITY;

-- Platform announcements: only master can manage (check profiles.role)
CREATE POLICY "Master users can manage platform announcements"
  ON platform_announcements FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'master'
    )
  );

-- Onboarding email log: master can see all, others see their tenant
CREATE POLICY "Master can view all onboarding logs"
  ON onboarding_email_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'master'
    )
  );

CREATE POLICY "Users can view their tenant onboarding logs"
  ON onboarding_email_log FOR SELECT
  USING (
    tenant_id IN (
      SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()
    )
  );

-- Company announcements: tenant-scoped
CREATE POLICY "Users can view their company announcements"
  ON company_announcements FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Admins can manage company announcements"
  ON company_announcements FOR ALL
  USING (
    tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('master', 'corporate', 'office_admin')
    )
  );

-- Announcement reads
CREATE POLICY "Users can manage their own reads"
  ON company_announcement_reads FOR ALL
  USING (user_id = auth.uid());

-- Indexes for performance
CREATE INDEX idx_platform_announcements_status ON platform_announcements(status);
CREATE INDEX idx_platform_announcements_sent_at ON platform_announcements(sent_at DESC);
CREATE INDEX idx_onboarding_email_log_tenant ON onboarding_email_log(tenant_id);
CREATE INDEX idx_onboarding_email_log_sent_at ON onboarding_email_log(sent_at DESC);
CREATE INDEX idx_company_announcements_tenant ON company_announcements(tenant_id);
CREATE INDEX idx_company_announcements_status ON company_announcements(tenant_id, status);
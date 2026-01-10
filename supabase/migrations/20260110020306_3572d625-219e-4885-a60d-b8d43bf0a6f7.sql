-- =============================================
-- EXTERNAL LEAD CAPTURE: Company API Keys
-- =============================================

-- Create table for company API keys (used for external lead submissions)
CREATE TABLE IF NOT EXISTS public.company_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  api_key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  permissions TEXT[] DEFAULT ARRAY['lead_submission'],
  is_active BOOLEAN DEFAULT true,
  rate_limit_per_hour INTEGER DEFAULT 100,
  allowed_ips TEXT[],
  last_used_at TIMESTAMPTZ,
  usage_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES profiles(id)
);

-- Create index for fast API key lookups
CREATE INDEX idx_company_api_keys_hash ON company_api_keys(api_key_hash) WHERE is_active = true;
CREATE INDEX idx_company_api_keys_prefix ON company_api_keys(key_prefix) WHERE is_active = true;
CREATE INDEX idx_company_api_keys_tenant ON company_api_keys(tenant_id);

-- Enable RLS
ALTER TABLE company_api_keys ENABLE ROW LEVEL SECURITY;

-- RLS policies - use valid app_role values (master, owner, corporate, office_admin)
CREATE POLICY "Admins can manage API keys for their tenant"
  ON company_api_keys FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    ) AND EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('master', 'owner', 'corporate', 'office_admin')
    )
  );

-- Create external_lead_submissions table to track incoming leads
CREATE TABLE IF NOT EXISTS public.external_lead_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES company_api_keys(id),
  contact_id UUID REFERENCES contacts(id),
  pipeline_entry_id UUID REFERENCES pipeline_entries(id),
  appointment_id UUID REFERENCES appointments(id),
  raw_payload JSONB NOT NULL,
  lead_source TEXT,
  source_url TEXT,
  ip_address INET,
  user_agent TEXT,
  processing_status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Create index for tracking submissions
CREATE INDEX idx_external_lead_submissions_tenant ON external_lead_submissions(tenant_id);
CREATE INDEX idx_external_lead_submissions_api_key ON external_lead_submissions(api_key_id);
CREATE INDEX idx_external_lead_submissions_created ON external_lead_submissions(created_at);

-- Enable RLS
ALTER TABLE external_lead_submissions ENABLE ROW LEVEL SECURITY;

-- RLS policies for external_lead_submissions
CREATE POLICY "Users can view their tenant's lead submissions"
  ON external_lead_submissions FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Add comment for documentation
COMMENT ON TABLE company_api_keys IS 'API keys for external integrations like website forms, Zapier, etc.';
COMMENT ON TABLE external_lead_submissions IS 'Tracks all lead submissions from external sources via API';
-- Customer referrals and rewards tracking
CREATE TABLE IF NOT EXISTS customer_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  referrer_contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  referred_name TEXT NOT NULL,
  referred_email TEXT,
  referred_phone TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'converted', 'rejected')),
  reward_points_earned INTEGER DEFAULT 0,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer reward points balance
CREATE TABLE IF NOT EXISTS customer_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE UNIQUE,
  points_balance INTEGER DEFAULT 0,
  lifetime_points_earned INTEGER DEFAULT 0,
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reward redemptions
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  points_redeemed INTEGER NOT NULL,
  redemption_type TEXT NOT NULL CHECK (redemption_type IN ('cash', 'gift', 'project_credit')),
  value NUMERIC(10,2),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'fulfilled', 'rejected')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Attorney requests
CREATE TABLE IF NOT EXISTS attorney_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled')),
  assigned_attorney TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Additional service quote requests
CREATE TABLE IF NOT EXISTS service_quote_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'quoted', 'accepted', 'declined')),
  quote_amount NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Job status milestones for customer view
CREATE TABLE IF NOT EXISTS customer_job_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  milestone_key TEXT NOT NULL,
  milestone_name TEXT NOT NULL,
  description TEXT,
  document_url TEXT,
  video_url TEXT,
  is_complete BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer uploaded photos
CREATE TABLE IF NOT EXISTS customer_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  description TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add customer portal status to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer_portal_status TEXT DEFAULT 'contract_deposit';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS permit_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS certificate_of_completion_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS warranty_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lien_waiver_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS wind_mitigation_eligible BOOLEAN DEFAULT false;

-- Enable RLS
ALTER TABLE customer_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attorney_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_job_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_photos ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tenant isolation
CREATE POLICY "Tenant isolation for customer_referrals" ON customer_referrals FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for customer_rewards" ON customer_rewards FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for reward_redemptions" ON reward_redemptions FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for attorney_requests" ON attorney_requests FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for service_quote_requests" ON service_quote_requests FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for customer_job_milestones" ON customer_job_milestones FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Tenant isolation for customer_photos" ON customer_photos FOR ALL USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_customer_referrals_contact ON customer_referrals(referrer_contact_id);
CREATE INDEX IF NOT EXISTS idx_customer_rewards_contact ON customer_rewards(contact_id);
CREATE INDEX IF NOT EXISTS idx_customer_milestones_project ON customer_job_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_customer_photos_project ON customer_photos(project_id);
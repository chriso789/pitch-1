-- Phase 30: Loyalty Points System
-- Points for referrals, reviews, repeat business redeemable for discounts

-- Loyalty points ledger table
CREATE TABLE IF NOT EXISTS loyalty_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'earn_referral', 'earn_review', 'earn_repeat_job', 'earn_survey', 
    'earn_bonus', 'redeem_discount', 'expire', 'adjustment'
  )),
  description TEXT,
  reference_id UUID,
  reference_type TEXT,
  balance_after INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_loyalty_points_tenant ON loyalty_points(tenant_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_contact ON loyalty_points(contact_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_created ON loyalty_points(created_at DESC);

-- Enable RLS
ALTER TABLE loyalty_points ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view loyalty points for their tenant"
  ON loyalty_points FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert loyalty points for their tenant"
  ON loyalty_points FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update loyalty points for their tenant"
  ON loyalty_points FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Loyalty settings per tenant
CREATE TABLE IF NOT EXISTS loyalty_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  points_per_referral INTEGER NOT NULL DEFAULT 100,
  points_per_review INTEGER NOT NULL DEFAULT 50,
  points_per_job INTEGER NOT NULL DEFAULT 200,
  points_per_survey INTEGER NOT NULL DEFAULT 25,
  points_per_dollar_redemption NUMERIC(10,2) NOT NULL DEFAULT 0.01,
  min_redeem_points INTEGER NOT NULL DEFAULT 500,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE loyalty_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view loyalty settings for their tenant"
  ON loyalty_settings FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage loyalty settings for their tenant"
  ON loyalty_settings FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Loyalty redemptions tracking
CREATE TABLE IF NOT EXISTS loyalty_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  points_redeemed INTEGER NOT NULL,
  discount_amount NUMERIC(10,2) NOT NULL,
  redemption_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired', 'cancelled')),
  used_on_job_id UUID REFERENCES jobs(id),
  expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE loyalty_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view redemptions for their tenant"
  ON loyalty_redemptions FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert redemptions for their tenant"
  ON loyalty_redemptions FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Function to get loyalty balance for a contact
CREATE OR REPLACE FUNCTION get_loyalty_balance(p_contact_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(SUM(points), 0)::INTEGER
  FROM loyalty_points
  WHERE contact_id = p_contact_id;
$$;

-- Phase 22: Automated Review Collection - review request tracking
CREATE TABLE IF NOT EXISTS review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('google', 'yelp', 'facebook', 'bbb', 'other')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'opened', 'completed', 'declined')),
  sent_via TEXT[] DEFAULT '{}',
  send_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  review_url TEXT,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_for TIMESTAMPTZ,
  reminder_count INTEGER DEFAULT 0,
  max_reminders INTEGER DEFAULT 3
);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage review requests for their tenant"
  ON review_requests FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_review_requests_tenant ON review_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_requests_contact ON review_requests(contact_id);
CREATE INDEX IF NOT EXISTS idx_review_requests_status ON review_requests(status);
CREATE INDEX IF NOT EXISTS idx_review_requests_scheduled ON review_requests(scheduled_for) WHERE status = 'pending';

-- Phase 23: Referral Reward Fulfillment tracking
-- Referral rewards ledger
CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  referral_code_id UUID REFERENCES referral_codes(id) ON DELETE SET NULL,
  referrer_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversion_id UUID REFERENCES referral_conversions(id) ON DELETE SET NULL,
  reward_type TEXT NOT NULL CHECK (reward_type IN ('cash', 'credit', 'gift_card', 'discount', 'points')),
  reward_value NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'fulfilled', 'failed', 'cancelled')),
  fulfillment_method TEXT,
  fulfillment_details JSONB DEFAULT '{}',
  fulfilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE referral_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage referral rewards for their tenant"
  ON referral_rewards FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_referral_rewards_tenant ON referral_rewards(tenant_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards(status) WHERE status = 'pending';
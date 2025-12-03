-- Add subscription management columns to tenants
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'starter',
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active',
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS features_enabled TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS billing_email TEXT,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Add comments for documentation
COMMENT ON COLUMN tenants.subscription_tier IS 'Subscription tier: starter, professional, enterprise';
COMMENT ON COLUMN tenants.subscription_status IS 'Subscription status: active, past_due, canceled, trialing';

-- Create indexes for subscription queries
CREATE INDEX IF NOT EXISTS idx_tenants_subscription_tier ON tenants(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_tenants_subscription_status ON tenants(subscription_status);
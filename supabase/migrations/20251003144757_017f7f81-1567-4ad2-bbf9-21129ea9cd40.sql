-- Create stripe_connect_accounts table
CREATE TABLE public.stripe_connect_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  onboarding_complete BOOLEAN DEFAULT false,
  payouts_enabled BOOLEAN DEFAULT false,
  charges_enabled BOOLEAN DEFAULT false,
  account_type TEXT DEFAULT 'express',
  details_submitted BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- Create payout_transactions table
CREATE TABLE public.payout_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  reward_id UUID REFERENCES public.achievement_rewards(id),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_transfer_id TEXT,
  stripe_payout_id TEXT,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',
  status TEXT DEFAULT 'pending',
  failure_reason TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.stripe_connect_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for stripe_connect_accounts
CREATE POLICY "Users can view their own Stripe accounts"
  ON public.stripe_connect_accounts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own Stripe accounts"
  ON public.stripe_connect_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update their own Stripe accounts"
  ON public.stripe_connect_accounts
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all Stripe accounts in tenant"
  ON public.stripe_connect_accounts
  FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

-- RLS Policies for payout_transactions
CREATE POLICY "Users can view their own payouts"
  ON public.payout_transactions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can insert payout transactions"
  ON public.payout_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "System can update payout transactions"
  ON public.payout_transactions
  FOR UPDATE
  TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can view all payouts in tenant"
  ON public.payout_transactions
  FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

-- Create indexes
CREATE INDEX idx_stripe_connect_accounts_user_id ON public.stripe_connect_accounts(user_id);
CREATE INDEX idx_stripe_connect_accounts_tenant_id ON public.stripe_connect_accounts(tenant_id);
CREATE INDEX idx_payout_transactions_user_id ON public.payout_transactions(user_id);
CREATE INDEX idx_payout_transactions_reward_id ON public.payout_transactions(reward_id);
CREATE INDEX idx_payout_transactions_status ON public.payout_transactions(status);
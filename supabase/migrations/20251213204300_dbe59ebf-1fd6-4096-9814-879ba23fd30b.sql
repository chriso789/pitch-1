-- Add manager override and reports_to fields to profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS manager_override_rate NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS reports_to_manager_id UUID REFERENCES profiles(id);

-- Create manager override earnings tracking table
CREATE TABLE IF NOT EXISTS manager_override_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  manager_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  sales_rep_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  commission_earning_id UUID REFERENCES commission_earnings(id) ON DELETE CASCADE,
  job_number TEXT,
  contract_value NUMERIC NOT NULL DEFAULT 0,
  override_rate NUMERIC NOT NULL DEFAULT 0,
  override_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE manager_override_earnings ENABLE ROW LEVEL SECURITY;

-- RLS policies for manager_override_earnings
CREATE POLICY "Users can view their own overrides"
  ON manager_override_earnings
  FOR SELECT
  USING (manager_id = auth.uid() OR sales_rep_id = auth.uid());

CREATE POLICY "System can insert overrides"
  ON manager_override_earnings
  FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Managers can update their override status"
  ON manager_override_earnings
  FOR UPDATE
  USING (manager_id = auth.uid());

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_manager_override_earnings_manager ON manager_override_earnings(manager_id);
CREATE INDEX IF NOT EXISTS idx_manager_override_earnings_tenant ON manager_override_earnings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_reports_to ON profiles(reports_to_manager_id);
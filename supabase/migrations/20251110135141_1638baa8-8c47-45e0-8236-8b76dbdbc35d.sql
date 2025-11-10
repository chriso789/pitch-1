-- Create price sync logs table
CREATE TABLE IF NOT EXISTS price_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK (sync_type IN ('manual', 'scheduled', 'on_demand')),
  vendor_code TEXT NOT NULL,
  total_skus INTEGER DEFAULT 0,
  successful_updates INTEGER DEFAULT 0,
  failed_updates INTEGER DEFAULT 0,
  errors JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  triggered_by UUID REFERENCES profiles(id),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial')) DEFAULT 'running',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create price history table
CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  product_name TEXT,
  vendor_code TEXT NOT NULL,
  old_price NUMERIC(10,2),
  new_price NUMERIC(10,2) NOT NULL,
  price_change_pct NUMERIC(5,2),
  branch_code TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sync_log_id UUID REFERENCES price_sync_logs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_price_sync_logs_tenant ON price_sync_logs(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_sync_logs_status ON price_sync_logs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_tenant ON price_history(tenant_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_sku ON price_history(sku, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_vendor ON price_history(vendor_code, changed_at DESC);

-- Enable RLS
ALTER TABLE price_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for price_sync_logs
CREATE POLICY "Users can view their tenant's sync logs"
  ON price_sync_logs FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Service role can insert sync logs"
  ON price_sync_logs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update sync logs"
  ON price_sync_logs FOR UPDATE
  USING (true);

-- RLS Policies for price_history
CREATE POLICY "Users can view their tenant's price history"
  ON price_history FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Service role can insert price history"
  ON price_history FOR INSERT
  WITH CHECK (true);

-- Function to calculate price change percentage
CREATE OR REPLACE FUNCTION calculate_price_change_pct(old_price NUMERIC, new_price NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
  IF old_price IS NULL OR old_price = 0 THEN
    RETURN NULL;
  END IF;
  RETURN ROUND(((new_price - old_price) / old_price * 100)::NUMERIC, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;
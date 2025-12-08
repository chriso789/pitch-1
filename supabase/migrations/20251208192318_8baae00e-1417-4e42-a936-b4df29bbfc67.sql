
-- Commission adjustments table for credits, chargebacks, bonuses
CREATE TABLE public.commission_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  pipeline_entry_id UUID REFERENCES public.pipeline_entries(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('credit', 'chargeback', 'bonus', 'deduction', 'material_credit', 'other')),
  amount DECIMAL(10,2) NOT NULL,
  description TEXT NOT NULL,
  applies_to TEXT DEFAULT 'profit' CHECK (applies_to IN ('profit', 'gross_revenue')),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Commission earnings table for tracking calculated commissions
CREATE TABLE public.commission_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  pipeline_entry_id UUID REFERENCES public.pipeline_entries(id) ON DELETE SET NULL,
  estimate_id UUID REFERENCES public.estimates(id) ON DELETE SET NULL,
  
  -- Job info
  job_number TEXT,
  customer_name TEXT,
  job_address TEXT,
  closed_date DATE,
  
  -- Financial breakdown
  contract_value DECIMAL(10,2) NOT NULL,
  actual_material_cost DECIMAL(10,2) DEFAULT 0,
  actual_labor_cost DECIMAL(10,2) DEFAULT 0,
  total_adjustments DECIMAL(10,2) DEFAULT 0,
  gross_profit DECIMAL(10,2) NOT NULL,
  rep_overhead_rate DECIMAL(5,2) DEFAULT 0,
  rep_overhead_amount DECIMAL(10,2) DEFAULT 0,
  net_profit DECIMAL(10,2) NOT NULL,
  
  -- Commission calculation
  commission_type TEXT NOT NULL CHECK (commission_type IN ('percentage_selling_price', 'profit_split')),
  commission_rate DECIMAL(5,2) NOT NULL,
  commission_amount DECIMAL(10,2) NOT NULL,
  
  -- Status tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
  paid_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.commission_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_earnings ENABLE ROW LEVEL SECURITY;

-- RLS policies for commission_adjustments
CREATE POLICY "Users can view their tenant's commission adjustments"
  ON public.commission_adjustments FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Managers can insert commission adjustments"
  ON public.commission_adjustments FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Managers can update commission adjustments"
  ON public.commission_adjustments FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Managers can delete commission adjustments"
  ON public.commission_adjustments FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- RLS policies for commission_earnings
CREATE POLICY "Users can view their tenant's commission earnings"
  ON public.commission_earnings FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "System can insert commission earnings"
  ON public.commission_earnings FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Managers can update commission earnings"
  ON public.commission_earnings FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Indexes for performance
CREATE INDEX idx_commission_adjustments_tenant ON public.commission_adjustments(tenant_id);
CREATE INDEX idx_commission_adjustments_user ON public.commission_adjustments(user_id);
CREATE INDEX idx_commission_adjustments_project ON public.commission_adjustments(project_id);
CREATE INDEX idx_commission_earnings_tenant ON public.commission_earnings(tenant_id);
CREATE INDEX idx_commission_earnings_user ON public.commission_earnings(user_id);
CREATE INDEX idx_commission_earnings_status ON public.commission_earnings(status);
CREATE INDEX idx_commission_earnings_closed_date ON public.commission_earnings(closed_date);

-- Trigger for updated_at
CREATE TRIGGER update_commission_adjustments_updated_at
  BEFORE UPDATE ON public.commission_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_commission_earnings_updated_at
  BEFORE UPDATE ON public.commission_earnings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

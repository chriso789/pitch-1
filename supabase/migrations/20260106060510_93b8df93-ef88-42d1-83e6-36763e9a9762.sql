-- Create project_cost_invoices table for uploaded invoices
CREATE TABLE IF NOT EXISTS project_cost_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  project_id UUID REFERENCES projects(id) NOT NULL,
  pipeline_entry_id UUID REFERENCES pipeline_entries(id),
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('material', 'labor')),
  
  -- Invoice details
  vendor_name TEXT,
  crew_name TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  invoice_amount NUMERIC(12,2) NOT NULL,
  
  -- Document storage
  document_url TEXT,
  document_name TEXT,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_review')),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Notes
  notes TEXT,
  
  -- Audit
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create project_cost_reconciliation table for tracking estimated vs actual
CREATE TABLE IF NOT EXISTS project_cost_reconciliation (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) NOT NULL,
  project_id UUID REFERENCES projects(id) NOT NULL,
  
  -- Original Budget (from estimate at project creation)
  original_material_cost NUMERIC(12,2) DEFAULT 0,
  original_labor_cost NUMERIC(12,2) DEFAULT 0,
  original_overhead NUMERIC(12,2) DEFAULT 0,
  original_profit NUMERIC(12,2) DEFAULT 0,
  original_selling_price NUMERIC(12,2) DEFAULT 0,
  
  -- Actual Costs (from uploaded invoices)
  actual_material_cost NUMERIC(12,2) DEFAULT 0,
  actual_labor_cost NUMERIC(12,2) DEFAULT 0,
  actual_overhead NUMERIC(12,2) DEFAULT 0,
  
  -- Calculated variance columns
  material_variance NUMERIC(12,2) GENERATED ALWAYS AS (actual_material_cost - original_material_cost) STORED,
  labor_variance NUMERIC(12,2) GENERATED ALWAYS AS (actual_labor_cost - original_labor_cost) STORED,
  total_variance NUMERIC(12,2) GENERATED ALWAYS AS (
    (actual_material_cost + actual_labor_cost) - (original_material_cost + original_labor_cost)
  ) STORED,
  final_profit NUMERIC(12,2) GENERATED ALWAYS AS (
    original_selling_price - actual_material_cost - actual_labor_cost - actual_overhead
  ) STORED,
  
  -- Reconciliation status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'disputed')),
  final_approved_by UUID REFERENCES profiles(id),
  final_approved_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(project_id)
);

-- Add cost verification columns to production_workflows
ALTER TABLE production_workflows 
  ADD COLUMN IF NOT EXISTS cost_verification_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cost_verification_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cost_verification_status TEXT DEFAULT 'not_started';

-- Enable RLS
ALTER TABLE project_cost_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_cost_reconciliation ENABLE ROW LEVEL SECURITY;

-- RLS Policies for project_cost_invoices
CREATE POLICY "Users can view invoices for their tenant" ON project_cost_invoices
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert invoices for their tenant" ON project_cost_invoices
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update invoices for their tenant" ON project_cost_invoices
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete invoices for their tenant" ON project_cost_invoices
  FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- RLS Policies for project_cost_reconciliation
CREATE POLICY "Users can view reconciliation for their tenant" ON project_cost_reconciliation
  FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert reconciliation for their tenant" ON project_cost_reconciliation
  FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update reconciliation for their tenant" ON project_cost_reconciliation
  FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_project_cost_invoices_project ON project_cost_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_project_cost_invoices_tenant ON project_cost_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_cost_invoices_type ON project_cost_invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_project_cost_reconciliation_project ON project_cost_reconciliation(project_id);
CREATE INDEX IF NOT EXISTS idx_project_cost_reconciliation_tenant ON project_cost_reconciliation(tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_cost_reconciliation_status ON project_cost_reconciliation(status);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_cost_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_cost_invoices_updated_at
  BEFORE UPDATE ON project_cost_invoices
  FOR EACH ROW EXECUTE FUNCTION update_cost_invoices_updated_at();

CREATE TRIGGER trigger_update_cost_reconciliation_updated_at
  BEFORE UPDATE ON project_cost_reconciliation
  FOR EACH ROW EXECUTE FUNCTION update_cost_invoices_updated_at();
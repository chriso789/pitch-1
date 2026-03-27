-- Project invoices for internal AR tracking
CREATE TABLE project_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  pipeline_entry_id UUID NOT NULL REFERENCES pipeline_entries(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  balance NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  due_date DATE,
  sent_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Project payments for payment tracking
CREATE TABLE project_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  pipeline_entry_id UUID NOT NULL REFERENCES pipeline_entries(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES project_invoices(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT,
  reference_number TEXT,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_project_invoices_tenant ON project_invoices(tenant_id);
CREATE INDEX idx_project_invoices_pipeline ON project_invoices(pipeline_entry_id);
CREATE INDEX idx_project_invoices_status ON project_invoices(status);
CREATE INDEX idx_project_payments_tenant ON project_payments(tenant_id);
CREATE INDEX idx_project_payments_pipeline ON project_payments(pipeline_entry_id);
CREATE INDEX idx_project_payments_invoice ON project_payments(invoice_id);

-- RLS
ALTER TABLE project_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for project_invoices"
  ON project_invoices FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Tenant isolation for project_payments"
  ON project_payments FOR ALL
  TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Auto-update updated_at on project_invoices
CREATE TRIGGER set_updated_at_project_invoices
  BEFORE UPDATE ON project_invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
-- Add locations table qbo_location_ref column if not exists
ALTER TABLE locations 
ADD COLUMN IF NOT EXISTS qbo_location_ref TEXT;

-- Create invoice_ar_mirror table
CREATE TABLE IF NOT EXISTS invoice_ar_mirror (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  qbo_invoice_id TEXT NOT NULL,
  doc_number TEXT NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  balance NUMERIC NOT NULL DEFAULT 0,
  qbo_status TEXT NOT NULL DEFAULT 'Draft',
  last_qbo_pull_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, project_id)
);

-- Enable RLS
ALTER TABLE invoice_ar_mirror ENABLE ROW LEVEL SECURITY;

-- RLS policies for invoice_ar_mirror
CREATE POLICY "Users can view invoice mirrors in their tenant"
  ON invoice_ar_mirror FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage invoice mirrors in tenant"
  ON invoice_ar_mirror FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- Create index
CREATE INDEX IF NOT EXISTS idx_invoice_ar_mirror_project ON invoice_ar_mirror(project_id);
CREATE INDEX IF NOT EXISTS idx_invoice_ar_mirror_qbo_invoice ON invoice_ar_mirror(qbo_invoice_id);
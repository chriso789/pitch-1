-- Create sequence table for tenant-scoped numbering
CREATE TABLE IF NOT EXISTS clj_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sequence_type TEXT NOT NULL CHECK (sequence_type IN ('contact', 'lead', 'job')),
  current_value INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, sequence_type)
);

-- Enable RLS on sequences
ALTER TABLE clj_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their tenant sequences" ON clj_sequences;
CREATE POLICY "Users can view their tenant sequences" ON clj_sequences
  FOR SELECT USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can update their tenant sequences" ON clj_sequences;
CREATE POLICY "Users can update their tenant sequences" ON clj_sequences
  FOR UPDATE USING (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can insert tenant sequences" ON clj_sequences;
CREATE POLICY "Users can insert tenant sequences" ON clj_sequences
  FOR INSERT WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  ));
-- Create document_tag_placements table for storing smart tag positions on documents
CREATE TABLE document_tag_placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_key TEXT NOT NULL,
  page_number INTEGER DEFAULT 1,
  x_position DECIMAL(10, 4) NOT NULL,
  y_position DECIMAL(10, 4) NOT NULL,
  width DECIMAL(10, 4) NOT NULL,
  height DECIMAL(10, 4) NOT NULL,
  font_size INTEGER DEFAULT 12,
  font_family TEXT DEFAULT 'Arial',
  text_align TEXT DEFAULT 'left',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX idx_document_tag_placements_document ON document_tag_placements(document_id);
CREATE INDEX idx_document_tag_placements_tenant ON document_tag_placements(tenant_id);

-- Enable RLS
ALTER TABLE document_tag_placements ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own tenant document tag placements"
  ON document_tag_placements FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can insert own tenant document tag placements"
  ON document_tag_placements FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update own tenant document tag placements"
  ON document_tag_placements FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can delete own tenant document tag placements"
  ON document_tag_placements FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_document_tag_placements_updated_at
  BEFORE UPDATE ON document_tag_placements
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
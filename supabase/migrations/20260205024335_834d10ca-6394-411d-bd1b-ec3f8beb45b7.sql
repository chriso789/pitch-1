-- Create junction table linking estimate templates to company documents
-- This allows specific documents (e.g., OBC vs SS PDF) to be auto-attached to estimates
-- using certain templates (e.g., 5V Metal, Standing Seam)

CREATE TABLE IF NOT EXISTS estimate_template_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES estimate_templates(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  attachment_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(template_id, document_id)
);

-- Enable RLS
ALTER TABLE estimate_template_attachments ENABLE ROW LEVEL SECURITY;

-- Policy: Users can manage attachments for templates in their tenant
CREATE POLICY "Users can manage template attachments for their tenant"
ON estimate_template_attachments
FOR ALL
USING (
  tenant_id IN (
    SELECT p.active_tenant_id FROM profiles p WHERE p.id = auth.uid()
    UNION
    SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()
  )
);

-- Index for faster lookups by template
CREATE INDEX idx_template_attachments_template_id ON estimate_template_attachments(template_id);

-- Cleanup: Delete the incorrectly uploaded image.jpg from Company Docs
DELETE FROM documents 
WHERE id = '90464293-b371-4b97-8436-53a2b5cf0953';

COMMENT ON TABLE estimate_template_attachments IS 'Links company documents to estimate templates for auto-attachment during PDF generation';
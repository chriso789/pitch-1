-- Add invoice tracking fields to documents table
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS invoice_amount DECIMAL(12,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS linked_invoice_id UUID REFERENCES project_cost_invoices(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS vendor_name TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS invoice_number TEXT DEFAULT NULL;

-- Create index for invoice lookups
CREATE INDEX IF NOT EXISTS idx_documents_linked_invoice ON documents(linked_invoice_id) WHERE linked_invoice_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN documents.invoice_amount IS 'Invoice amount for invoice-type documents';
COMMENT ON COLUMN documents.linked_invoice_id IS 'FK to project_cost_invoices when document is an invoice';
COMMENT ON COLUMN documents.vendor_name IS 'Vendor or crew name for invoice documents';
COMMENT ON COLUMN documents.invoice_number IS 'Invoice number for invoice documents';
-- Make audit tables work with project_cost_invoices (where actual material invoices live)
-- by dropping the strict FKs that pointed at the empty material_invoice_documents tree.
ALTER TABLE public.material_invoice_audits
  DROP CONSTRAINT IF EXISTS material_invoice_audits_invoice_document_id_fkey;
ALTER TABLE public.material_invoice_audit_lines
  DROP CONSTRAINT IF EXISTS material_invoice_audit_lines_invoice_line_item_id_fkey;
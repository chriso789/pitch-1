-- Add 'verified' to status constraint
ALTER TABLE project_cost_invoices DROP CONSTRAINT IF EXISTS project_cost_invoices_status_check;
ALTER TABLE project_cost_invoices ADD CONSTRAINT project_cost_invoices_status_check 
  CHECK (status = ANY (ARRAY['pending','approved','rejected','needs_review','verified']));

-- Add 'overhead' to invoice_type constraint
ALTER TABLE project_cost_invoices DROP CONSTRAINT IF EXISTS project_cost_invoices_invoice_type_check;
ALTER TABLE project_cost_invoices ADD CONSTRAINT project_cost_invoices_invoice_type_check 
  CHECK (invoice_type = ANY (ARRAY['material','labor','overhead']));
ALTER TABLE public.project_cost_invoices
  ADD COLUMN IF NOT EXISTS service_address text;

CREATE INDEX IF NOT EXISTS idx_project_cost_invoices_service_address
  ON public.project_cost_invoices (tenant_id, service_address);

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS service_address text;
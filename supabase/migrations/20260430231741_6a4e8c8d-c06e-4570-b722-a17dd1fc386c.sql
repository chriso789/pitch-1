ALTER TABLE public.project_cost_invoices
  ADD COLUMN IF NOT EXISTS change_order_id uuid REFERENCES public.change_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_cost_invoices_change_order_id
  ON public.project_cost_invoices(change_order_id);
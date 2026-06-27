
ALTER TABLE public.project_invoices ADD COLUMN IF NOT EXISTS cc_fee_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.project_invoices ADD COLUMN IF NOT EXISTS cc_fee_percent numeric NOT NULL DEFAULT 0;
ALTER TABLE public.project_payments ADD COLUMN IF NOT EXISTS cc_fee_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS company_lead_fee_rate numeric NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
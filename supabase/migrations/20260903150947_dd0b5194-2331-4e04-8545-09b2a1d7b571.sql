ALTER TABLE public.tenants ALTER COLUMN company_lead_fee_rate SET DEFAULT 3;
UPDATE public.tenants SET company_lead_fee_rate = 3 WHERE company_lead_fee_rate IS NULL OR company_lead_fee_rate = 0;
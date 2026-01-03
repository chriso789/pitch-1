-- Just add the demo_requests column
ALTER TABLE public.demo_requests 
ADD COLUMN IF NOT EXISTS converted_to_company_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL;
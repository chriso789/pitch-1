ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS support_email text;
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_support_email_format;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_support_email_format CHECK (support_email IS NULL OR support_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
UPDATE public.tenants SET support_email = 'support@obriencontractingusa.com' WHERE id = '14de934e-7964-4afd-940a-620d2ace125d' AND support_email IS NULL;
NOTIFY pgrst, 'reload schema';
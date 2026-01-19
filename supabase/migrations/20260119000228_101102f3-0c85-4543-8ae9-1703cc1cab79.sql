-- Copy estimate templates from O'Brien to East Coast
INSERT INTO public.estimate_templates (id, tenant_id, name, template_data, is_active, roof_type, created_at, updated_at)
SELECT 
  gen_random_uuid(),
  'cea48616-dc2c-4ee2-806b-ce0e75411bd4', -- East Coast
  name,
  template_data,
  is_active,
  roof_type,
  NOW(),
  NOW()
FROM public.estimate_templates
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d' -- O'Brien
ON CONFLICT DO NOTHING;

-- Copy tenant_estimate_settings from O'Brien to East Coast
INSERT INTO public.tenant_estimate_settings (tenant_id, fine_print_content, default_include_fine_print, default_pdf_view_mode, default_terms)
SELECT 
  'cea48616-dc2c-4ee2-806b-ce0e75411bd4',
  fine_print_content,
  default_include_fine_print,
  default_pdf_view_mode,
  default_terms
FROM public.tenant_estimate_settings
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
ON CONFLICT (tenant_id) DO NOTHING;

-- Update East Coast location with proper contact info
UPDATE public.locations
SET 
  phone = '5613145120',
  email = 'eastcoastrs1@gmail.com',
  name = COALESCE(NULLIF(name, ''), 'Main Office')
WHERE tenant_id = 'cea48616-dc2c-4ee2-806b-ce0e75411bd4'
  AND phone IS NULL;

-- Update default overhead rate from 5% to 10%
ALTER TABLE public.profiles 
  ALTER COLUMN overhead_rate SET DEFAULT 10.00;

-- Update existing 5% overhead values to 10%
UPDATE public.profiles 
SET overhead_rate = 10.00 
WHERE overhead_rate = 5.00;
-- Fix foreign key relationships and create missing profile data
-- First, let's add the missing foreign key for estimates to projects
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_estimates_project_id ON public.estimates(project_id);

-- Create missing profile for the current user
INSERT INTO public.profiles (
  id,
  email,
  first_name,
  last_name,
  role,
  is_developer,
  tenant_id,
  company_name,
  title
) VALUES (
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9',
  'chrisobrien91@gmail.com',
  'Chris',
  'O''Brien',
  'master'::app_role,
  true,
  (SELECT id FROM public.tenants LIMIT 1),
  'O''Brien Contracting',
  'Master Developer'
) ON CONFLICT (id) DO UPDATE SET
  role = 'master'::app_role,
  is_developer = true,
  company_name = 'O''Brien Contracting',
  title = 'Master Developer';

-- Create O'Brien Contracting tenant if it doesn't exist
INSERT INTO public.tenants (name, subdomain, settings) 
VALUES ('O''Brien Contracting', 'obrien', '{}') 
ON CONFLICT (name) DO NOTHING;

-- Update profile with correct tenant
UPDATE public.profiles 
SET tenant_id = (SELECT id FROM public.tenants WHERE name = 'O''Brien Contracting' LIMIT 1)
WHERE id = '0a56229d-1722-4ea0-90ec-c42fdac6fcc9';

-- Create developer access grant for master user
INSERT INTO public.developer_access_grants (
  developer_id,
  tenant_id,
  access_type,
  is_active,
  granted_by
) VALUES (
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9',
  (SELECT id FROM public.tenants WHERE name = 'O''Brien Contracting' LIMIT 1),
  'full',
  true,
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'
) ON CONFLICT DO NOTHING;
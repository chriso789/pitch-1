-- Fix database schema and create profile data
-- Add missing foreign key for estimates to projects if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'estimates' AND column_name = 'project_id'
    ) THEN
        ALTER TABLE public.estimates ADD COLUMN project_id UUID REFERENCES public.projects(id);
        CREATE INDEX idx_estimates_project_id ON public.estimates(project_id);
    END IF;
END $$;

-- Create O'Brien Contracting tenant
INSERT INTO public.tenants (id, name, subdomain, settings) 
VALUES (gen_random_uuid(), 'O''Brien Contracting', 'obrien', '{}')
ON CONFLICT (name) DO NOTHING;

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
  title,
  is_active
) 
SELECT 
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid,
  'chrisobrien91@gmail.com',
  'Chris',
  'O''Brien',
  'master'::app_role,
  true,
  t.id,
  'O''Brien Contracting',
  'Master Developer',
  true
FROM public.tenants t 
WHERE t.name = 'O''Brien Contracting'
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  is_developer = EXCLUDED.is_developer,
  company_name = EXCLUDED.company_name,
  title = EXCLUDED.title,
  tenant_id = EXCLUDED.tenant_id;

-- Create developer access grant
INSERT INTO public.developer_access_grants (
  id,
  developer_id,
  tenant_id,
  access_type,
  is_active,
  granted_by,
  granted_at
) 
SELECT 
  gen_random_uuid(),
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid,
  t.id,
  'full',
  true,
  '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid,
  now()
FROM public.tenants t 
WHERE t.name = 'O''Brien Contracting'
AND NOT EXISTS (
  SELECT 1 FROM public.developer_access_grants 
  WHERE developer_id = '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'::uuid 
  AND tenant_id = t.id
);
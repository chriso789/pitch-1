-- Simple fix for database issues
-- Add missing foreign key for estimates to projects
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_estimates_project_id ON public.estimates(project_id);

-- Create O'Brien Contracting tenant if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE name = 'O''Brien Contracting') THEN
        INSERT INTO public.tenants (name, subdomain, settings) 
        VALUES ('O''Brien Contracting', 'obrien', '{}');
    END IF;
END $$;

-- Create or update profile for the current user
DO $$
DECLARE
    tenant_uuid UUID;
BEGIN
    -- Get the tenant ID
    SELECT id INTO tenant_uuid FROM public.tenants WHERE name = 'O''Brien Contracting';
    
    -- Delete existing profile if it exists
    DELETE FROM public.profiles WHERE id = '0a56229d-1722-4ea0-90ec-c42fdac6fcc9';
    
    -- Insert new profile
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
    ) VALUES (
        '0a56229d-1722-4ea0-90ec-c42fdac6fcc9',
        'chrisobrien91@gmail.com',
        'Chris',
        'O''Brien',
        'master',
        true,
        tenant_uuid,
        'O''Brien Contracting',
        'Master Developer',
        true
    );
    
    -- Create developer access grant
    IF NOT EXISTS (
        SELECT 1 FROM public.developer_access_grants 
        WHERE developer_id = '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'
        AND tenant_id = tenant_uuid
    ) THEN
        INSERT INTO public.developer_access_grants (
            developer_id,
            tenant_id,
            access_type,
            is_active,
            granted_by
        ) VALUES (
            '0a56229d-1722-4ea0-90ec-c42fdac6fcc9',
            tenant_uuid,
            'full',
            true,
            '0a56229d-1722-4ea0-90ec-c42fdac6fcc9'
        );
    END IF;
END $$;
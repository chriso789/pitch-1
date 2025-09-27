-- Check if jobs table exists and has proper structure
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'jobs' AND table_schema = 'public'
ORDER BY ordinal_position;

-- If jobs table doesn't exist or is missing key columns, create/update it
CREATE TABLE IF NOT EXISTS public.jobs (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    pipeline_entry_id uuid,
    job_number text UNIQUE,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'pending',
    priority text DEFAULT 'medium',
    estimated_value numeric,
    roof_type text,
    address_street text,
    project_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Add missing columns if they don't exist
DO $$
BEGIN
    -- Add job_number column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'job_number') THEN
        ALTER TABLE public.jobs ADD COLUMN job_number text;
    END IF;
    
    -- Add pipeline_entry_id if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'pipeline_entry_id') THEN
        ALTER TABLE public.jobs ADD COLUMN pipeline_entry_id uuid;
    END IF;
    
    -- Add tenant_id if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'tenant_id') THEN
        ALTER TABLE public.jobs ADD COLUMN tenant_id uuid NOT NULL DEFAULT '14de934e-7964-4afd-940a-620d2ace125d';
    END IF;
    
    -- Add address_street if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'address_street') THEN
        ALTER TABLE public.jobs ADD COLUMN address_street text;
    END IF;
    
    -- Add priority if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'priority') THEN
        ALTER TABLE public.jobs ADD COLUMN priority text DEFAULT 'medium';
    END IF;
    
    -- Add estimated_value if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'estimated_value') THEN
        ALTER TABLE public.jobs ADD COLUMN estimated_value numeric;
    END IF;
    
    -- Add roof_type if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'roof_type') THEN
        ALTER TABLE public.jobs ADD COLUMN roof_type text;
    END IF;
END $$;

-- Enable RLS
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for jobs table
DROP POLICY IF EXISTS "Users can view jobs in their tenant" ON public.jobs;
CREATE POLICY "Users can view jobs in their tenant" 
ON public.jobs 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "Users can create jobs in their tenant" ON public.jobs;
CREATE POLICY "Users can create jobs in their tenant" 
ON public.jobs 
FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "Users can update jobs in their tenant" ON public.jobs;
CREATE POLICY "Users can update jobs in their tenant" 
ON public.jobs 
FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "Admins can delete jobs in their tenant" ON public.jobs;
CREATE POLICY "Admins can delete jobs in their tenant" 
ON public.jobs 
FOR DELETE 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Add job number trigger if it doesn't exist
CREATE OR REPLACE TRIGGER auto_assign_job_number_trigger
    BEFORE INSERT ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_assign_job_number();
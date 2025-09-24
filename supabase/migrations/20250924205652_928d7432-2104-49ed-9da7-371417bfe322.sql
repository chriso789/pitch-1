-- Add contact_number field to contacts table
ALTER TABLE public.contacts ADD COLUMN contact_number TEXT;

-- Create sequences for numbering
CREATE SEQUENCE IF NOT EXISTS contact_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS job_number_seq START 1000;

-- Create function to generate contact numbers (format: XX-XX)
CREATE OR REPLACE FUNCTION generate_contact_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    next_num INTEGER;
    contact_num TEXT;
BEGIN
    next_num := nextval('contact_number_seq');
    contact_num := LPAD((next_num / 100 + 1)::TEXT, 2, '0') || '-' || LPAD((next_num % 100)::TEXT, 2, '0');
    RETURN contact_num;
END;
$$;

-- Create function to generate job numbers (format: XXXX-XX)
CREATE OR REPLACE FUNCTION generate_job_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    next_num INTEGER;
    job_num TEXT;
BEGIN
    next_num := nextval('job_number_seq');
    job_num := LPAD((next_num / 100 + 1000)::TEXT, 4, '0') || '-' || LPAD((next_num % 100 + 1)::TEXT, 2, '0');
    RETURN job_num;
END;
$$;

-- Update existing contacts with contact numbers in order of creation
DO $$
DECLARE
    contact_rec RECORD;
BEGIN
    FOR contact_rec IN 
        SELECT id FROM contacts 
        WHERE contact_number IS NULL 
        ORDER BY created_at
    LOOP
        UPDATE contacts 
        SET contact_number = generate_contact_number()
        WHERE id = contact_rec.id;
    END LOOP;
END $$;

-- Reset sequence to start from where we left off
SELECT setval('contact_number_seq', (SELECT COUNT(*) FROM contacts WHERE contact_number IS NOT NULL));

-- Create trigger to auto-assign contact numbers for new contacts
CREATE OR REPLACE FUNCTION auto_assign_contact_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    IF NEW.contact_number IS NULL THEN
        NEW.contact_number := generate_contact_number();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER assign_contact_number_trigger
    BEFORE INSERT ON public.contacts
    FOR EACH ROW
    EXECUTE FUNCTION auto_assign_contact_number();

-- Create jobs table (separate from projects)
CREATE TABLE public.jobs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    job_number TEXT NOT NULL UNIQUE,
    contact_id UUID NOT NULL,
    project_id UUID,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on jobs table
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for jobs
CREATE POLICY "Users can view jobs in their tenant" 
ON public.jobs 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create jobs in their tenant" 
ON public.jobs 
FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update jobs in their tenant" 
ON public.jobs 
FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete jobs in their tenant" 
ON public.jobs 
FOR DELETE 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create trigger to auto-assign job numbers
CREATE OR REPLACE FUNCTION auto_assign_job_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    IF NEW.job_number IS NULL THEN
        NEW.job_number := generate_job_number();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER assign_job_number_trigger
    BEFORE INSERT ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION auto_assign_job_number();

-- Add updated_at trigger for jobs
CREATE TRIGGER update_jobs_updated_at
    BEFORE UPDATE ON public.jobs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
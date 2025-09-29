-- Add foreign key constraints to jobs table

-- Add foreign key from jobs to contacts
ALTER TABLE public.jobs 
ADD CONSTRAINT jobs_contact_id_fkey 
FOREIGN KEY (contact_id) 
REFERENCES public.contacts(id) 
ON DELETE CASCADE;

-- Add foreign key from jobs to projects
ALTER TABLE public.jobs 
ADD CONSTRAINT jobs_project_id_fkey 
FOREIGN KEY (project_id) 
REFERENCES public.projects(id) 
ON DELETE SET NULL;
-- Make job_number nullable temporarily during insert (trigger will set it)
ALTER TABLE public.jobs ALTER COLUMN job_number DROP NOT NULL;
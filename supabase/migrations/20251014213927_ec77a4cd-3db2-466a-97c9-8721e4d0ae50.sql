-- Create sequence for project job numbers (starting from 1)
CREATE SEQUENCE IF NOT EXISTS project_job_number_seq START 1;

-- Create function to generate project job numbers (format: JOB-XXXX)
CREATE OR REPLACE FUNCTION public.generate_project_job_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    next_num INTEGER;
    job_num TEXT;
BEGIN
    next_num := nextval('project_job_number_seq');
    job_num := 'JOB-' || LPAD(next_num::TEXT, 4, '0');
    RETURN job_num;
END;
$$;

-- Create trigger function to auto-assign project job numbers
CREATE OR REPLACE FUNCTION public.auto_assign_project_job_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.project_number IS NULL THEN
        NEW.project_number := generate_project_job_number();
    END IF;
    RETURN NEW;
END;
$$;

-- Create trigger to auto-assign project job numbers on insert
DROP TRIGGER IF EXISTS trigger_auto_assign_project_job_number ON public.projects;
CREATE TRIGGER trigger_auto_assign_project_job_number
    BEFORE INSERT ON public.projects
    FOR EACH ROW
    EXECUTE FUNCTION auto_assign_project_job_number();

-- Backfill existing projects without job numbers (ordered by creation date)
DO $$
DECLARE
    project_record RECORD;
BEGIN
    FOR project_record IN 
        SELECT id 
        FROM projects 
        WHERE project_number IS NULL 
        ORDER BY created_at ASC
    LOOP
        UPDATE projects 
        SET project_number = generate_project_job_number()
        WHERE id = project_record.id;
    END LOOP;
END $$;
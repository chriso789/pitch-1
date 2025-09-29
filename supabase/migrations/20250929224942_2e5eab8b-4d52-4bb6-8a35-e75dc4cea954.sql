-- Create new simple job number generation function
CREATE OR REPLACE FUNCTION public.generate_simple_job_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    next_num INTEGER;
    job_num TEXT;
BEGIN
    next_num := nextval('job_number_seq');
    job_num := 'JOB-' || LPAD(next_num::TEXT, 4, '0');
    RETURN job_num;
END;
$function$;

-- Update the auto-assign trigger to use the new function
CREATE OR REPLACE FUNCTION public.auto_assign_job_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.job_number IS NULL THEN
        NEW.job_number := generate_simple_job_number();
    END IF;
    RETURN NEW;
END;
$function$;

-- Renumber existing active jobs in order of creation
DO $$
DECLARE
    job_record RECORD;
    new_job_num TEXT;
    counter INTEGER := 1;
BEGIN
    -- Renumber all active (non-deleted) jobs in order of created_at
    FOR job_record IN 
        SELECT id 
        FROM public.jobs 
        WHERE is_deleted = false OR is_deleted IS NULL
        ORDER BY created_at ASC
    LOOP
        new_job_num := 'JOB-' || LPAD(counter::TEXT, 4, '0');
        
        UPDATE public.jobs 
        SET job_number = new_job_num 
        WHERE id = job_record.id;
        
        counter := counter + 1;
    END LOOP;
    
    -- Reset the sequence to continue from where we left off
    PERFORM setval('job_number_seq', counter - 1);
END $$;
-- Create a trigger to automatically create jobs when pipeline entries advance to 'project' status
CREATE OR REPLACE FUNCTION public.create_job_from_pipeline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    -- Only create job when status changes TO 'project' (not when it changes FROM 'project')
    IF NEW.status = 'project' AND (OLD.status IS NULL OR OLD.status != 'project') THEN
        -- Check if a job already exists for this pipeline entry
        IF NOT EXISTS (
            SELECT 1 FROM jobs 
            WHERE pipeline_entry_id = NEW.id
        ) THEN
            -- Create job record
            INSERT INTO jobs (
                tenant_id,
                pipeline_entry_id,
                contact_id,
                name,
                description,
                status,
                created_by,
                estimated_value,
                roof_type
            ) VALUES (
                NEW.tenant_id,
                NEW.id,
                NEW.contact_id,
                COALESCE(
                    (SELECT first_name || ' ' || last_name || ' - ' || COALESCE(address_street, 'Roofing Project')
                     FROM contacts WHERE id = NEW.contact_id),
                    'Roofing Project'
                ),
                'Job created from approved pipeline entry',
                'pending',
                auth.uid(),
                NEW.estimated_value,
                NEW.roof_type
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$;

-- Create the trigger
DROP TRIGGER IF EXISTS trigger_create_job_from_pipeline ON pipeline_entries;
CREATE TRIGGER trigger_create_job_from_pipeline
    AFTER UPDATE ON pipeline_entries
    FOR EACH ROW
    EXECUTE FUNCTION create_job_from_pipeline();
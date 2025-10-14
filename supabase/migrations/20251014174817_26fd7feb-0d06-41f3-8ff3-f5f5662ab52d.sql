-- Fix the create_job_from_pipeline trigger to use valid job_status enum value
CREATE OR REPLACE FUNCTION public.create_job_from_pipeline()
RETURNS trigger
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
                'production',
                auth.uid(),
                NEW.estimated_value,
                NEW.roof_type
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$;
-- Fix missing production workflows for approved projects
-- Step 1: Create production workflows for projects that don't have them
INSERT INTO production_workflows (
    tenant_id,
    project_id,
    pipeline_entry_id,
    current_stage,
    created_by
)
SELECT 
    p.tenant_id,
    p.id as project_id,
    p.pipeline_entry_id,
    'submit_documents' as current_stage,
    p.created_by
FROM projects p
INNER JOIN pipeline_entries pe ON pe.id = p.pipeline_entry_id
WHERE pe.status = 'project'
AND NOT EXISTS (
    SELECT 1 FROM production_workflows pw 
    WHERE pw.project_id = p.id
)
ON CONFLICT DO NOTHING;

-- Step 2: Create initial stage history entries for the workflows we just created
INSERT INTO production_stage_history (
    tenant_id,
    production_workflow_id,
    from_stage,
    to_stage,
    changed_by,
    notes
)
SELECT 
    pw.tenant_id,
    pw.id as production_workflow_id,
    NULL as from_stage,
    'submit_documents' as to_stage,
    pw.created_by,
    'Production workflow created for approved lead' as notes
FROM production_workflows pw
WHERE NOT EXISTS (
    SELECT 1 FROM production_stage_history psh
    WHERE psh.production_workflow_id = pw.id
)
ON CONFLICT DO NOTHING;

-- Step 3: Ensure the trigger function exists and is correct
CREATE OR REPLACE FUNCTION public.create_production_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    project_record RECORD;
BEGIN
    -- Only trigger when status changes to 'project'
    IF NEW.status = 'project' AND (OLD.status IS NULL OR OLD.status != 'project') THEN
        
        -- Get or create project record
        SELECT * INTO project_record
        FROM projects 
        WHERE pipeline_entry_id = NEW.id;
        
        -- If no project exists, create one
        IF project_record IS NULL THEN
            INSERT INTO projects (
                tenant_id,
                pipeline_entry_id,
                name,
                description,
                status,
                created_by
            ) VALUES (
                NEW.tenant_id,
                NEW.id,
                'Project from Pipeline Entry',
                'Auto-created project from approved pipeline entry',
                'active',
                COALESCE(auth.uid(), NEW.created_by)
            ) RETURNING * INTO project_record;
        END IF;
        
        -- Create production workflow if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM production_workflows 
            WHERE project_id = project_record.id
        ) THEN
            INSERT INTO production_workflows (
                tenant_id,
                project_id,
                pipeline_entry_id,
                current_stage,
                created_by
            ) VALUES (
                NEW.tenant_id,
                project_record.id,
                NEW.id,
                'submit_documents',
                COALESCE(auth.uid(), NEW.created_by)
            );
            
            -- Add initial stage history
            INSERT INTO production_stage_history (
                tenant_id,
                production_workflow_id,
                to_stage,
                changed_by,
                notes
            ) VALUES (
                NEW.tenant_id,
                (SELECT id FROM production_workflows WHERE project_id = project_record.id),
                'submit_documents',
                COALESCE(auth.uid(), NEW.created_by),
                'Production workflow started from approved lead'
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Step 4: Drop and recreate the trigger to ensure it's active
DROP TRIGGER IF EXISTS create_production_workflow_trigger ON pipeline_entries;

CREATE TRIGGER create_production_workflow_trigger
    AFTER INSERT OR UPDATE OF status ON pipeline_entries
    FOR EACH ROW
    EXECUTE FUNCTION create_production_workflow();
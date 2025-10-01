-- Update the api_approve_job_from_lead function to automatically create production workflows
CREATE OR REPLACE FUNCTION public.api_approve_job_from_lead(
    pipeline_entry_id_param uuid, 
    approval_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    pipeline_entry RECORD;
    approval_record RECORD;
    project_record RECORD;
    workflow_record RECORD;
    result JSONB;
BEGIN
    -- Check if user has manager permissions
    IF NOT (has_role('admin') OR has_role('manager') OR has_role('master')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
    END IF;

    -- Get pipeline entry
    SELECT * INTO pipeline_entry
    FROM pipeline_entries
    WHERE id = pipeline_entry_id_param 
    AND tenant_id = get_user_tenant_id();

    IF pipeline_entry IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pipeline entry not found');
    END IF;

    -- Check if there's a pending approval request
    SELECT * INTO approval_record
    FROM manager_approval_queue
    WHERE pipeline_entry_id = pipeline_entry_id_param
    AND status = 'pending'
    AND tenant_id = get_user_tenant_id();

    IF approval_record IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No pending approval request found');
    END IF;

    -- Update approval record
    UPDATE manager_approval_queue
    SET 
        status = 'approved',
        approved_by = auth.uid(),
        approved_at = now(),
        manager_notes = approval_notes,
        updated_at = now()
    WHERE id = approval_record.id;

    -- Create project from pipeline entry
    INSERT INTO projects (
        tenant_id,
        pipeline_entry_id,
        name,
        description,
        status,
        created_by
    ) VALUES (
        pipeline_entry.tenant_id,
        pipeline_entry.id,
        'Project: ' || COALESCE(
            (SELECT first_name || ' ' || last_name FROM contacts WHERE id = pipeline_entry.contact_id),
            'Unnamed Customer'
        ),
        'Project created from approved lead',
        'active',
        auth.uid()
    ) RETURNING * INTO project_record;

    -- Create initial production workflow
    INSERT INTO production_workflows (
        tenant_id,
        project_id,
        pipeline_entry_id,
        current_stage,
        created_by
    ) VALUES (
        pipeline_entry.tenant_id,
        project_record.id,
        pipeline_entry.id,
        'submit_documents',
        auth.uid()
    ) RETURNING * INTO workflow_record;

    -- Log the initial production stage
    INSERT INTO production_stage_history (
        tenant_id,
        production_workflow_id,
        to_stage,
        changed_by,
        notes
    ) VALUES (
        pipeline_entry.tenant_id,
        workflow_record.id,
        'submit_documents',
        auth.uid(),
        'Production workflow started from approved lead'
    );

    -- Update pipeline entry status
    UPDATE pipeline_entries
    SET 
        status = 'project',
        updated_at = now()
    WHERE id = pipeline_entry_id_param;

    -- Log approval history
    INSERT INTO manager_approval_history (
        tenant_id,
        approval_queue_id,
        action,
        performed_by,
        previous_status,
        new_status,
        notes
    ) VALUES (
        get_user_tenant_id(),
        approval_record.id,
        'approved',
        auth.uid(),
        'pending',
        'approved',
        approval_notes
    );

    result := jsonb_build_object(
        'success', true,
        'project_id', project_record.id,
        'project_clj_number', project_record.clj_formatted_number,
        'workflow_id', workflow_record.id,
        'approval_id', approval_record.id,
        'message', 'Lead successfully converted to project with production workflow'
    );

    RETURN result;
END;
$function$;
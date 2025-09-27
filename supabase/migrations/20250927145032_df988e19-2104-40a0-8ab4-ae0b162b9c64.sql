-- Fix the policy conflict and create the core RPC function for manager approval

-- Drop existing conflicting policies if they exist
DROP POLICY IF EXISTS "System can manage weather cache in tenant" ON public.weather_cache;

-- Weather cache policies (with unique names)
CREATE POLICY "weather_cache_tenant_access"
ON public.weather_cache FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Create the critical manager approval RPC function
CREATE OR REPLACE FUNCTION public.api_approve_job_from_lead(
    pipeline_entry_id_param UUID,
    approval_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    pipeline_entry RECORD;
    approval_record RECORD;
    project_record RECORD;
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
        'approval_id', approval_record.id,
        'message', 'Lead successfully converted to project'
    );

    RETURN result;
END;
$$;

-- Create function to request manager approval
CREATE OR REPLACE FUNCTION public.api_request_manager_approval(
    pipeline_entry_id_param UUID,
    estimated_value_param NUMERIC DEFAULT NULL,
    business_justification_param TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    pipeline_entry RECORD;
    approval_id UUID;
    result JSONB;
BEGIN
    -- Get pipeline entry
    SELECT * INTO pipeline_entry
    FROM pipeline_entries
    WHERE id = pipeline_entry_id_param 
    AND tenant_id = get_user_tenant_id();

    IF pipeline_entry IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pipeline entry not found');
    END IF;

    -- Check if approval request already exists
    IF EXISTS (
        SELECT 1 FROM manager_approval_queue
        WHERE pipeline_entry_id = pipeline_entry_id_param
        AND status = 'pending'
        AND tenant_id = get_user_tenant_id()
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Approval request already pending');
    END IF;

    -- Create approval request
    INSERT INTO manager_approval_queue (
        tenant_id,
        pipeline_entry_id,
        contact_id,
        requested_by,
        estimated_value,
        business_justification,
        priority
    ) VALUES (
        get_user_tenant_id(),
        pipeline_entry_id_param,
        pipeline_entry.contact_id,
        auth.uid(),
        estimated_value_param,
        business_justification_param,
        CASE 
            WHEN estimated_value_param > 50000 THEN 'high'
            WHEN estimated_value_param > 25000 THEN 'medium'
            ELSE 'low'
        END
    ) RETURNING id INTO approval_id;

    -- Log the request
    INSERT INTO manager_approval_history (
        tenant_id,
        approval_queue_id,
        action,
        performed_by,
        new_status,
        notes
    ) VALUES (
        get_user_tenant_id(),
        approval_id,
        'requested',
        auth.uid(),
        'pending',
        'Manager approval requested for lead to project conversion'
    );

    result := jsonb_build_object(
        'success', true,
        'approval_id', approval_id,
        'message', 'Manager approval request created successfully'
    );

    RETURN result;
END;
$$;

-- Update pipeline entries to add "On Hold (Mgr Review)" column capability
ALTER TABLE public.pipeline_entries
ADD COLUMN IF NOT EXISTS requires_manager_approval BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS manager_approval_status TEXT DEFAULT 'none';

-- Create function to enforce manager approval requirement
CREATE OR REPLACE FUNCTION public.enforce_manager_approval_gate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if trying to move to 'project' status
    IF NEW.status = 'project' AND OLD.status != 'project' THEN
        -- Check if this lead requires manager approval
        IF NEW.requires_manager_approval = true THEN
            -- Check if there's an approved manager approval
            IF NOT EXISTS (
                SELECT 1 FROM manager_approval_queue
                WHERE pipeline_entry_id = NEW.id
                AND status = 'approved'
                AND tenant_id = NEW.tenant_id
            ) THEN
                -- Block the status change and set to hold
                NEW.status = 'hold_manager_review';
                NEW.manager_approval_status = 'required';
                
                -- Create approval request if none exists
                INSERT INTO manager_approval_queue (
                    tenant_id,
                    pipeline_entry_id,
                    contact_id,
                    requested_by,
                    approval_type
                ) VALUES (
                    NEW.tenant_id,
                    NEW.id,
                    NEW.contact_id,
                    auth.uid(),
                    'lead_to_project'
                ) ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Create trigger for manager approval enforcement
DROP TRIGGER IF EXISTS manager_approval_gate_trigger ON public.pipeline_entries;
CREATE TRIGGER manager_approval_gate_trigger
    BEFORE UPDATE ON public.pipeline_entries
    FOR EACH ROW
    EXECUTE FUNCTION enforce_manager_approval_gate();
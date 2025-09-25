-- Add new "hold" status to pipeline_status enum
ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'hold_mgr_review';

-- Update existing pipeline stages to add the hold stage
INSERT INTO pipeline_stages (
  tenant_id,
  name,
  description,
  stage_order,
  probability_percent,
  color,
  is_active,
  created_by
) 
SELECT DISTINCT
  tenant_id,
  'Hold (Mgr Review)',
  'Waiting for manager approval to proceed to project',
  3.5, -- Between contingency (3) and project (4)
  80,
  '#f59e0b', -- amber color
  true,
  created_by
FROM pipeline_stages 
WHERE name = 'Contingency'
ON CONFLICT DO NOTHING;

-- Update existing project stage order to make room
UPDATE pipeline_stages 
SET stage_order = 4 
WHERE name = 'Project';

-- Create production workflow stages table
CREATE TABLE IF NOT EXISTS production_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  pipeline_entry_id UUID,
  current_stage TEXT NOT NULL DEFAULT 'submit_documents',
  stage_data JSONB NOT NULL DEFAULT '{}',
  noc_uploaded BOOLEAN NOT NULL DEFAULT false,
  permit_application_submitted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID,
  UNIQUE(project_id, tenant_id)
);

-- Enable RLS
ALTER TABLE production_workflows ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for production workflows
CREATE POLICY "Users can view production workflows in their tenant"
ON production_workflows
FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create production workflows in their tenant"
ON production_workflows
FOR INSERT
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update production workflows in their tenant"
ON production_workflows
FOR UPDATE
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete production workflows in their tenant"
ON production_workflows
FOR DELETE
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create production stage transitions audit table
CREATE TABLE IF NOT EXISTS production_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  production_workflow_id UUID NOT NULL REFERENCES production_workflows(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by UUID,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Enable RLS
ALTER TABLE production_stage_history ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for production stage history
CREATE POLICY "Users can view production stage history in their tenant"
ON production_stage_history
FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert production stage history"
ON production_stage_history
FOR INSERT
WITH CHECK (tenant_id = get_user_tenant_id());

-- Create approval requests table for hold -> project transitions
CREATE TABLE IF NOT EXISTS project_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  pipeline_entry_id UUID NOT NULL REFERENCES pipeline_entries(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes TEXT,
  rejection_reason TEXT,
  metadata JSONB DEFAULT '{}'
);

-- Enable RLS
ALTER TABLE project_approval_requests ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for approval requests
CREATE POLICY "Users can view approval requests in their tenant"
ON project_approval_requests
FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create approval requests in their tenant"
ON project_approval_requests
FOR INSERT
WITH CHECK (tenant_id = get_user_tenant_id());

-- Only managers can update approval requests
CREATE POLICY "Managers can update approval requests in their tenant"
ON project_approval_requests
FOR UPDATE
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create trigger to auto-start production workflow when pipeline moves to project
CREATE OR REPLACE FUNCTION create_production_workflow()
RETURNS TRIGGER AS $$
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
                auth.uid()
            ) RETURNING * INTO project_record;
        END IF;
        
        -- Create production workflow
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
            auth.uid()
        ) ON CONFLICT (project_id, tenant_id) DO NOTHING;
        
        -- Log the production start
        INSERT INTO production_stage_history (
            tenant_id,
            production_workflow_id,
            to_stage,
            changed_by,
            notes
        ) SELECT 
            NEW.tenant_id,
            pw.id,
            'submit_documents',
            auth.uid(),
            'Production workflow started automatically'
        FROM production_workflows pw 
        WHERE pw.project_id = project_record.id AND pw.tenant_id = NEW.tenant_id;
        
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create the trigger
DROP TRIGGER IF EXISTS auto_start_production ON pipeline_entries;
CREATE TRIGGER auto_start_production
    AFTER UPDATE ON pipeline_entries
    FOR EACH ROW
    EXECUTE FUNCTION create_production_workflow();

-- Add updated_at trigger for production workflows
CREATE TRIGGER update_production_workflows_updated_at
    BEFORE UPDATE ON production_workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to validate production stage transitions
CREATE OR REPLACE FUNCTION validate_production_stage_transition()
RETURNS TRIGGER AS $$
DECLARE
    stage_order JSONB := '{
        "submit_documents": 1,
        "permit_submitted": 2,
        "permit_approved": 3,
        "materials_ordered": 4,
        "materials_on_hold": 5,
        "materials_delivered": 6,
        "in_progress": 7,
        "complete": 8,
        "final_inspection": 9,
        "final_check_needed": 10,
        "closed": 11
    }';
    old_order INTEGER;
    new_order INTEGER;
BEGIN
    -- Get stage orders
    old_order := (stage_order ->> OLD.current_stage)::INTEGER;
    new_order := (stage_order ->> NEW.current_stage)::INTEGER;
    
    -- Check if trying to leave submit_documents without required docs
    IF OLD.current_stage = 'submit_documents' AND NEW.current_stage != 'submit_documents' THEN
        IF NOT NEW.noc_uploaded OR NOT NEW.permit_application_submitted THEN
            RAISE EXCEPTION 'Cannot advance from Submit Documents stage without uploading NOC and submitting permit application';
        END IF;
    END IF;
    
    -- Prevent skipping stages (allow going backwards for corrections)
    IF new_order > old_order + 1 THEN
        RAISE EXCEPTION 'Cannot skip production stages. Current: %, Target: %', OLD.current_stage, NEW.current_stage;
    END IF;
    
    -- Log the transition
    INSERT INTO production_stage_history (
        tenant_id,
        production_workflow_id,
        from_stage,
        to_stage,
        changed_by,
        notes
    ) VALUES (
        NEW.tenant_id,
        NEW.id,
        OLD.current_stage,
        NEW.current_stage,
        auth.uid(),
        'Stage transition: ' || OLD.current_stage || ' → ' || NEW.current_stage
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create the trigger
DROP TRIGGER IF EXISTS validate_production_transition ON production_workflows;
CREATE TRIGGER validate_production_transition
    BEFORE UPDATE ON production_workflows
    FOR EACH ROW
    WHEN (OLD.current_stage IS DISTINCT FROM NEW.current_stage)
    EXECUTE FUNCTION validate_production_stage_transition();
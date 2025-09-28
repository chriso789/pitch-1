-- Create manager_approval_queue table to match code expectations
CREATE TABLE IF NOT EXISTS public.manager_approval_queue (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    pipeline_entry_id UUID NOT NULL,
    contact_id UUID,
    requested_by UUID,
    estimated_value NUMERIC,
    business_justification TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'pending',
    approved_by UUID,
    approved_at TIMESTAMP WITH TIME ZONE,
    manager_notes TEXT,
    approval_type TEXT DEFAULT 'lead_to_project',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create manager_approval_history table for audit trail
CREATE TABLE IF NOT EXISTS public.manager_approval_history (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    approval_queue_id UUID NOT NULL,
    action TEXT NOT NULL,
    performed_by UUID,
    previous_status TEXT,
    new_status TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.manager_approval_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manager_approval_history ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for manager_approval_queue
CREATE POLICY "Users can view approval requests in their tenant" 
ON public.manager_approval_queue 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create approval requests in their tenant" 
ON public.manager_approval_queue 
FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Managers can update approval requests in their tenant" 
ON public.manager_approval_queue 
FOR UPDATE 
USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

-- Create RLS policies for manager_approval_history
CREATE POLICY "Users can view approval history in their tenant" 
ON public.manager_approval_history 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert approval history in their tenant" 
ON public.manager_approval_history 
FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

-- Add requires_manager_approval and manager_approval_status columns to pipeline_entries if they don't exist
ALTER TABLE public.pipeline_entries 
ADD COLUMN IF NOT EXISTS requires_manager_approval BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS manager_approval_status TEXT DEFAULT null;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_manager_approval_queue_tenant_status ON public.manager_approval_queue(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_manager_approval_queue_pipeline_entry ON public.manager_approval_queue(pipeline_entry_id);
CREATE INDEX IF NOT EXISTS idx_manager_approval_history_queue_id ON public.manager_approval_history(approval_queue_id);

-- Add hold_manager_review status to pipeline entries if not exists
ALTER TABLE public.pipeline_entries 
ALTER COLUMN status TYPE TEXT;
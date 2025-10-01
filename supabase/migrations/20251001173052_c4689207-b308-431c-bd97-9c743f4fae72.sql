-- Enhanced Status Transitions: Add tables for dynamic transition rules and validation

-- Table for storing dynamic transition rules
CREATE TABLE IF NOT EXISTS public.transition_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    required_role TEXT[], -- Array of roles that can make this transition
    requires_approval BOOLEAN DEFAULT false,
    requires_reason BOOLEAN DEFAULT false,
    min_time_in_stage_hours INTEGER DEFAULT 0,
    max_value_threshold NUMERIC, -- NULL means no limit
    min_value_threshold NUMERIC DEFAULT 0,
    job_type_filter TEXT[], -- NULL means applies to all types
    conditions JSONB DEFAULT '{}', -- Additional dynamic conditions
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table for detailed status transition history
CREATE TABLE IF NOT EXISTS public.status_transition_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    pipeline_entry_id UUID NOT NULL REFERENCES public.pipeline_entries(id) ON DELETE CASCADE,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    transitioned_by UUID,
    transition_reason TEXT,
    is_backward BOOLEAN DEFAULT false,
    requires_approval BOOLEAN DEFAULT false,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table for validation rules
CREATE TABLE IF NOT EXISTS public.transition_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    validation_type TEXT NOT NULL, -- 'document_required', 'field_required', 'time_based', 'dependency'
    applies_to_status TEXT NOT NULL,
    validation_config JSONB NOT NULL,
    error_message TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID
);

-- Add metadata fields to pipeline_entries
ALTER TABLE public.pipeline_entries 
ADD COLUMN IF NOT EXISTS status_entered_at TIMESTAMPTZ DEFAULT now(),
ADD COLUMN IF NOT EXISTS workflow_metadata JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS requires_manager_approval BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS manager_approval_status TEXT DEFAULT 'not_required',
ADD COLUMN IF NOT EXISTS last_status_change_reason TEXT;

-- Enable RLS
ALTER TABLE public.transition_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_transition_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transition_validations ENABLE ROW LEVEL SECURITY;

-- RLS Policies for transition_rules
CREATE POLICY "Users can view transition rules in their tenant"
    ON public.transition_rules FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage transition rules in their tenant"
    ON public.transition_rules FOR ALL
    USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin', 'manager', 'master']::app_role[]));

-- RLS Policies for status_transition_history
CREATE POLICY "Users can view status history in their tenant"
    ON public.status_transition_history FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert status history"
    ON public.status_transition_history FOR INSERT
    WITH CHECK (tenant_id = get_user_tenant_id());

-- RLS Policies for transition_validations
CREATE POLICY "Users can view validations in their tenant"
    ON public.transition_validations FOR SELECT
    USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage validations in their tenant"
    ON public.transition_validations FOR ALL
    USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin', 'manager', 'master']::app_role[]));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_transition_rules_tenant_status ON public.transition_rules(tenant_id, from_status, to_status) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_status_history_entry ON public.status_transition_history(pipeline_entry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transition_validations_status ON public.transition_validations(tenant_id, applies_to_status) WHERE is_active = true;

-- Insert default transition rules for standard workflow
INSERT INTO public.transition_rules (tenant_id, name, from_status, to_status, required_role, requires_approval, requires_reason) 
SELECT 
    t.id,
    'Default: Lead to Legal Review',
    'lead',
    'legal_review',
    ARRAY['admin', 'manager', 'sales_rep']::TEXT[],
    false,
    false
FROM public.profiles p
JOIN (SELECT DISTINCT tenant_id as id FROM public.profiles WHERE tenant_id IS NOT NULL) t ON true
WHERE NOT EXISTS (SELECT 1 FROM public.transition_rules WHERE name = 'Default: Lead to Legal Review')
LIMIT 1;

-- Insert backward transition rules requiring approval
INSERT INTO public.transition_rules (tenant_id, name, from_status, to_status, required_role, requires_approval, requires_reason)
SELECT 
    t.id,
    'Backward: Any to Hold',
    'project',
    'hold_mgr_review',
    ARRAY['admin', 'manager', 'sales_rep']::TEXT[],
    true,
    true
FROM public.profiles p
JOIN (SELECT DISTINCT tenant_id as id FROM public.profiles WHERE tenant_id IS NOT NULL) t ON true
WHERE NOT EXISTS (SELECT 1 FROM public.transition_rules WHERE name = 'Backward: Any to Hold')
LIMIT 1;
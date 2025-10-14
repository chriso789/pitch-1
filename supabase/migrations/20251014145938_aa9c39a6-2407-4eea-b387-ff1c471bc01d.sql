-- Create workflow automation system
CREATE TYPE workflow_phase AS ENUM (
  'planning',
  'implementation',
  'testing',
  'deployment',
  'monitoring',
  'optimization'
);

CREATE TABLE IF NOT EXISTS public.workflow_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  task_name TEXT NOT NULL,
  description TEXT,
  current_phase workflow_phase NOT NULL DEFAULT 'planning',
  ai_context JSONB DEFAULT '{}'::jsonb,
  completion_criteria JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workflow_phase_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  task_id UUID NOT NULL REFERENCES public.workflow_tasks(id) ON DELETE CASCADE,
  from_phase workflow_phase,
  to_phase workflow_phase NOT NULL,
  ai_reasoning TEXT,
  actions_taken JSONB DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.button_audit_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  button_name TEXT,
  button_type TEXT,
  has_onclick BOOLEAN NOT NULL DEFAULT false,
  has_error_handling BOOLEAN NOT NULL DEFAULT false,
  pathway_validated BOOLEAN NOT NULL DEFAULT false,
  issues JSONB DEFAULT '[]'::jsonb,
  recommendations JSONB DEFAULT '[]'::jsonb,
  last_audited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_workflow_tasks_tenant ON public.workflow_tasks(tenant_id);
CREATE INDEX idx_workflow_tasks_phase ON public.workflow_tasks(current_phase);
CREATE INDEX idx_workflow_phase_history_task ON public.workflow_phase_history(task_id);
CREATE INDEX idx_button_audit_file ON public.button_audit_results(file_path);

-- Enable RLS
ALTER TABLE public.workflow_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_phase_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.button_audit_results ENABLE ROW LEVEL SECURITY;

-- RLS Policies for workflow_tasks
CREATE POLICY "Users can view tasks in their tenant"
  ON public.workflow_tasks FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create tasks in their tenant"
  ON public.workflow_tasks FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update tasks in their tenant"
  ON public.workflow_tasks FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete tasks"
  ON public.workflow_tasks FOR DELETE
  USING (
    tenant_id = get_user_tenant_id() AND 
    has_any_role(ARRAY['admin'::app_role, 'master'::app_role])
  );

-- RLS Policies for workflow_phase_history
CREATE POLICY "Users can view phase history in their tenant"
  ON public.workflow_phase_history FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert phase history"
  ON public.workflow_phase_history FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

-- RLS Policies for button_audit_results
CREATE POLICY "Users can view audit results in their tenant"
  ON public.button_audit_results FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage audit results"
  ON public.button_audit_results FOR ALL
  USING (tenant_id = get_user_tenant_id());

COMMENT ON TABLE public.workflow_tasks IS 'AI-driven autonomous workflow tasks that progress automatically';
COMMENT ON TABLE public.workflow_phase_history IS 'History of workflow phase transitions with AI reasoning';
COMMENT ON TABLE public.button_audit_results IS 'Audit results for button pathways and error handling';